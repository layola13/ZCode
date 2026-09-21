import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProviderConfig, ProviderConfigMap, type ProviderConfigRuntime } from "@zcode/provider";
import { ApiKeyAccessConfig, ProviderApiConfig } from "@zcode/provider";
import type { ICredentialService } from "../src/credential/credential.js";
import { createRelayChannelService } from "../src/relay/relayChannelService.js";
import { eligibleKiloFreeModels } from "../src/relay/relayChannelKilo.js";

type ConfigService = ProviderConfigRuntime["configService"];

function createFakeConfigService() {
  let providers = new ProviderConfigMap();
  let order = 0;
  const service = {
    async read() {
      return {
        revision: "test",
        zcodeBuiltinRevision: "test",
        personalRevision: "test",
        zcodeBuiltinProviders: new ProviderConfigMap(),
        personalProviders: providers,
      };
    },
    async createPersonalProvider(input: { providerName?: string }) {
      order += 1;
      const providerId = `personal-test-${order}`;
      providers = providers.setRule({
        providerId,
        providerName: input.providerName ?? providerId,
        config: new ProviderConfig({ group: "standard-personal" }),
      });
      return Object.freeze({ providerId });
    },
    async savePersonalProviderOverlay(providerId: string, config: ProviderConfig) {
      const rule = providers.getRule(providerId);
      if (!rule) throw new Error(`Personal Provider 尚未创建: ${providerId}`);
      providers = providers.setRule({ ...rule, providerId, config });
      return { providers };
    },
    async deletePersonalProvider(providerId: string) {
      providers = providers.delete(providerId);
      return { providers };
    },
    async addPersonalModel(providerId: string, modelId: string) {
      const rule = providers.getRule(providerId);
      if (!rule) throw new Error(`Personal Provider 尚未创建: ${providerId}`);
      const current = rule.config.personalModelIds ?? [];
      if (current.includes(modelId)) throw new Error(`Model 已存在: ${providerId}/${modelId}`);
      providers = providers.setRule({
        ...rule,
        config: rule.config.withPersonalModelIds([...current, modelId]),
      });
      return { providers };
    },
    async deletePersonalModel(providerId: string, modelId: string) {
      const rule = providers.getRule(providerId);
      if (!rule) throw new Error(`Personal Provider 尚未创建: ${providerId}`);
      providers = providers.setRule({
        ...rule,
        config: rule.config.withPersonalModelIds(
          (rule.config.personalModelIds ?? []).filter((id) => id !== modelId),
        ),
      });
      return { providers };
    },
    __getProviders: () => providers,
  };
  return service as unknown as ConfigService & { __getProviders: () => ProviderConfigMap };
}

function createFakeCredentialService() {
  const store = new Map<string, string>();
  return {
    async load(key: string) {
      return store.get(key) ?? null;
    },
    async save(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    raw: store,
  } as unknown as ICredentialService & { raw: Map<string, string> };
}

async function createService() {
  const dataDir = await mkdtemp(join(tmpdir(), "relay-test-"));
  const credentialService = createFakeCredentialService();
  const configService = createFakeConfigService();
  const service = createRelayChannelService({
    configService,
    credentialService,
    dataDir,
  });
  return { service, credentialService, configService, dataDir };
}

test("save+list 脱敏：无明文 key，只有 preview 与 configured", async () => {
  const { service, credentialService } = await createService();
  const view = await service.saveChannel({
    providerName: "demo-relay",
    baseUrl: "https://relay.example/v1",
    apiKeys: ["sk-secret-abcdef1234"],
    groups: [{ id: "g1", name: "default", models: ["m1", "m2"] }],
  });
  assert.equal(view.providerName, "demo-relay");
  assert.equal(view.apiKeyConfigured, true);
  assert.equal(view.apiKeyPreview, "••••1234");
  assert.deepEqual(
    view.groups.map((group) => group.groupName),
    ["default"],
  );
  const serialized = JSON.stringify(await service.listChannels());
  assert.ok(!serialized.includes("sk-secret-abcdef1234"), "列表不得含明文密钥");
  assert.equal(credentialService.raw.size, 1);
});

test("更新不传 apiKeys 保留旧密钥；传空数组清空", async () => {
  const { service } = await createService();
  const created = await service.saveChannel({
    providerName: "keep-relay",
    baseUrl: "https://relay.example/v1",
    apiKeys: ["sk-old-key"],
    groups: [{ id: "g1", name: "default", models: [] }],
  });
  const kept = await service.saveChannel({ providerId: created.providerId });
  assert.equal(kept.apiKeyConfigured, true);
  const target = await service.resolveRelayTarget({ providerId: created.providerId });
  assert.equal(target.apiKey, "sk-old-key");
  const cleared = await service.saveChannel({ providerId: created.providerId, apiKeys: [] });
  assert.equal(cleared.apiKeyConfigured, false);
  await assert.rejects(
    service.resolveRelayTarget({ providerId: created.providerId }),
    /尚未配置密钥/,
  );
});

test("polling 轮换 key；禁用渠道/分组抛错不 fallback", async () => {
  const { service } = await createService();
  const created = await service.saveChannel({
    providerName: "poll-relay",
    baseUrl: "https://relay.example/v1",
    apiKeys: ["k1", "k2"],
    groups: [{ id: "g1", name: "default", keyMode: "polling", models: [] }],
  });
  const first = await service.resolveRelayTarget({ providerId: created.providerId });
  const second = await service.resolveRelayTarget({ providerId: created.providerId });
  const third = await service.resolveRelayTarget({ providerId: created.providerId });
  assert.deepEqual([first.apiKey, second.apiKey, third.apiKey], ["k1", "k2", "k1"]);
  assert.equal(first.groupRatio, 1);
  await service.saveChannel({ providerId: created.providerId, status: "disabled" });
  await assert.rejects(service.resolveRelayTarget({ providerId: created.providerId }), /已禁用/);
});

test("fetch 模型：子集校验失败 400 语义；save=false 不回写", async (t) => {
  const { service } = await createService();
  const created = await service.saveChannel({
    providerName: "fetch-relay",
    baseUrl: "https://relay.example/v1",
    apiKeys: ["k1"],
    groups: [{ id: "g1", name: "default", models: [] }],
  });
  t.mock.method(globalThis, "fetch", async () => ({
    ok: true,
    json: async () => ({ data: [{ id: "m1" }, { id: "m2" }] }),
  }));
  const models = await service.fetchChannelModels({
    providerId: created.providerId,
    groupId: "g1",
    save: false,
  });
  assert.deepEqual([...models], ["m1", "m2"]);
  await assert.rejects(
    service.fetchChannelModels({
      providerId: created.providerId,
      groupId: "g1",
      selectedModels: ["m1", "ghost"],
    }),
    /不在上游返回中/,
  );
});

test("thread selection：存取 + 渠道删除后读失效", async () => {
  const { service } = await createService();
  const created = await service.saveChannel({
    providerName: "sel-relay",
    apiKeys: ["k1"],
    groups: [{ id: "g1", name: "default", models: ["m1"] }],
  });
  assert.equal(await service.getThreadSelection("t1"), null);
  await service.setThreadSelection("t1", {
    providerId: created.providerId,
    groupId: "g1",
    model: "m1",
  });
  assert.deepEqual(await service.getThreadSelection("t1"), {
    providerId: created.providerId,
    groupId: "g1",
    model: "m1",
  });
  await service.setThreadSelection("t1", null);
  assert.equal(await service.getThreadSelection("t1"), null);
  await service.setThreadSelection("t2", { providerId: created.providerId });
  await service.deleteChannel(created.providerId);
  assert.equal(await service.getThreadSelection("t2"), null);
  assert.equal((await service.listChannels()).length, 0);
});

test("临时目录隔离", async () => {
  const { dataDir } = await createService();
  await rm(dataDir, { recursive: true, force: true });
});

test("kilo 免费模型过滤：isFree 或 :free/-free 后缀", () => {
  assert.deepEqual(
    eligibleKiloFreeModels({
      data: [
        { id: "kilo-auto/efficient", isFree: false },
        { id: "deepseek/deepseek-v3:free", isFree: false },
        { id: "qwen/qwen3-free", isFree: false },
        { id: "gpt-paid", isFree: false },
        { id: "  spaced-model:free  ", isFree: false },
        { id: "deepseek/deepseek-v3:free" },
        { id: "" },
      ],
    }),
    ["deepseek/deepseek-v3:free", "qwen/qwen3-free", "spaced-model:free"],
  );
  assert.deepEqual(eligibleKiloFreeModels({ data: [] }), []);
  assert.deepEqual(eligibleKiloFreeModels(null), []);
});

test("免费渠道 completeness 豁免 access.apiKey，但 api.baseUrl 照常必填", () => {
  const free = new ProviderConfig({
    group: "standard-personal",
    access: new ApiKeyAccessConfig(),
    api: new ProviderApiConfig({
      type: "openai-chat-completions",
      baseUrl: "https://x.example/v1",
    }),
    channel: { free: true, groups: [] },
    personalModelIds: ["m1"],
    modelOrder: [],
  });
  assert.deepEqual(free.validateComplete(), []);
  const noBase = new ProviderConfig({
    group: "standard-personal",
    access: new ApiKeyAccessConfig(),
    api: new ProviderApiConfig({ type: "openai-chat-completions" }),
    channel: { free: true, groups: [] },
    personalModelIds: ["m1"],
    modelOrder: [],
  });
  assert.ok(noBase.validateComplete().length > 0, "缺 baseUrl 仍不完整");
});

test("ensureKiloFreeChannel：补种 + 模型刷新 + resolve 空 key", async (t) => {
  const { service, configService } = await createService();
  let capturedHeaders: Record<string, string> = {};
  t.mock.method(globalThis, "fetch", async (_url: unknown, init?: { headers?: unknown }) => {
    capturedHeaders = { ...((init?.headers as Record<string, string>) ?? {}) };
    return {
      ok: true,
      json: async () => ({ data: [{ id: "a:free" }, { id: "paid-model" }] }),
    };
  });
  const view = await service.ensureKiloFreeChannel();
  assert.ok(view, "补种成功");
  assert.equal(view?.providerName, "Kilo 免费");
  assert.deepEqual(
    view?.groups.flatMap((group) => [...group.models]),
    ["a:free"],
  );
  assert.ok(!("Authorization" in capturedHeaders), "免费拉取不带 Authorization");
  const target = await service.resolveRelayTarget({ providerId: view.providerId });
  assert.equal(target.apiKey, "");
  assert.ok(target.baseUrl.includes("kilo.ai"));
  // 幂等：第二次不重复创建
  const again = await service.ensureKiloFreeChannel();
  assert.equal(again?.providerId, view.providerId);
  assert.equal((await service.listChannels()).length, 1);
  // 回归：成员必须真实落盘（overlay 名单会被领域丢弃，曾导致门禁无模型）。
  const stored = (configService as unknown as { __getProviders: () => ProviderConfigMap })
    .__getProviders()
    .getRule(view.providerId);
  assert.ok(stored?.config.personalModelIds?.includes("a:free"), "personalModelIds 落盘");
});
