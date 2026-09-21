import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProviderConfig, ProviderConfigMap, type ProviderConfigRuntime } from "@zcode/provider";
import type { ICredentialService } from "../src/credential/credential.js";
import { createRelayChannelService } from "../src/relay/relayChannelService.js";

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
  };
  return service as unknown as ConfigService;
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
  const service = createRelayChannelService({
    configService: createFakeConfigService(),
    credentialService,
    dataDir,
  });
  return { service, credentialService, dataDir };
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
