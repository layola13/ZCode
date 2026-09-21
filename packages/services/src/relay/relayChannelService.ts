import {
  ApiKeyAccessConfig,
  ModelConfig,
  ProviderApiConfig,
  ProviderConfig,
  previewRelayKey,
  toRelayChannelGroupView,
  type RelayChannel,
  type RelayChannelGroup,
  type RelayChannelSelection,
  type RelayChannelView,
} from "@zcode/provider";
import type { ICredentialService } from "../credential/credential.js";
import { createServiceLogger } from "../logger/serviceLogger.js";
import type { ProviderConfigRuntime } from "../model-provider/providerConfigRuntime.js";
import { getAppConfigDir } from "../paths.js";
import {
  fetchRelayChannelModelsInputSchema,
  resolveRelayTargetInputSchema,
  saveRelayChannelInputSchema,
  type FetchRelayChannelModelsInput,
  type IRelayChannelService,
  type ResolveRelayTargetInput,
  type ResolvedRelayTarget,
  type SaveRelayChannelInput,
} from "./relayChannel.js";
import {
  ensureKiloFreeChannelImpl,
  fetchKiloFreeModelIds,
  KILO_USER_AGENT,
} from "./relayChannelKilo.js";
import { createThreadSelectionStore } from "./relayChannelThreads.js";

const logger = createServiceLogger("relayChannelService");
const MODELS_FETCH_TIMEOUT_MS = 12000;
const MAX_MODELS_PER_FETCH = 2000;

export interface RelayChannelServiceOptions {
  readonly configService: ProviderConfigRuntime["configService"];
  readonly credentialService: ICredentialService;
  readonly dataDir?: string;
}

function credentialKeyFor(providerId: string): string {
  return `relay-channel:${providerId}`;
}

/**
 * 成员同步（领域规则：`savePersonalProviderOverlay` 不拥有成员变更，
 * 传入的 personalModelIds 会被静默丢弃；必须走 add/delete 差分）。
 */
async function syncPersonalModels(
  configService: ProviderConfigRuntime["configService"],
  providerId: string,
  wanted: readonly string[],
): Promise<void> {
  const next = new Set(wanted.map((model) => model.trim()).filter(Boolean));
  const snapshot = await configService.read();
  const current = new Set(
    snapshot.personalProviders.getRule(providerId)?.config.personalModelIds ?? [],
  );
  for (const modelId of next) {
    if (current.has(modelId)) continue;
    await configService
      .addPersonalModel(providerId, modelId, new ModelConfig({ enabled: true }))
      .catch((error: unknown) => {
        // 并发补种/重复添加时以磁盘为准，后续重读对账，不阻断整体同步。
        logger.warn(undefined, "relay channel 模型添加跳过", {
          providerId,
          modelId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }
  const refreshed = await configService.read();
  const stored = refreshed.personalProviders.getRule(providerId)?.config.personalModelIds ?? [];
  for (const modelId of stored) {
    if (next.has(modelId)) continue;
    await configService.deletePersonalModel(providerId, modelId).catch((error: unknown) => {
      logger.warn(undefined, "relay channel 模型删除跳过", {
        providerId,
        modelId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}

export function createRelayChannelService(
  options: RelayChannelServiceOptions,
): IRelayChannelService {
  const dataDir = options.dataDir ?? getAppConfigDir();
  const { configService, credentialService } = options;
  const threadSelections = createThreadSelectionStore(dataDir);
  // polling cursor 只活在进程内存：轮换是负载手段不是持久状态，重启复位可接受。
  const pollingCursors = new Map<string, number>();

  async function loadKeys(providerId: string): Promise<string[]> {
    const raw = await credentialService.load(credentialKeyFor(providerId));
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item): item is string => typeof item === "string" && item.length > 0);
    } catch {
      logger.warn(undefined, "relay channel keys corrupt; treating as empty", { providerId });
      return [];
    }
  }

  async function toView(
    providerId: string,
    providerName: string,
    config: ProviderConfig,
  ): Promise<RelayChannelView> {
    const channel = config.channel ?? {};
    const keys = await loadKeys(providerId);
    const groups = channel.groups ?? [];
    const baseUrl = channel.baseUrl ?? config.api?.baseUrl ?? undefined;
    return {
      providerId,
      providerName,
      ...(baseUrl ? { baseUrl } : {}),
      status: channel.status ?? "enabled",
      apiKeyConfigured: keys.length > 0,
      ...(keys.length > 0 ? { apiKeyPreview: previewRelayKey(keys[0]!) } : {}),
      groups: Object.freeze(groups.map((group) => toRelayChannelGroupView(group, keys.length > 0))),
    };
  }

  async function readChannelProviders(): Promise<
    Array<{ providerId: string; providerName: string; config: ProviderConfig }>
  > {
    const snapshot = await configService.read();
    const result: Array<{ providerId: string; providerName: string; config: ProviderConfig }> = [];
    for (const rule of snapshot.personalProviders.rules()) {
      if (rule.config.group !== "standard-personal") continue;
      if (rule.config.channel == null || rule.config.channel.trashedAt != null) continue;
      result.push({
        providerId: rule.providerId,
        providerName: rule.providerName ?? rule.providerId,
        config: rule.config,
      });
    }
    return result;
  }

  function pickGroup(
    channel: RelayChannel,
    groupId?: string | null,
  ): RelayChannelGroup | undefined {
    const groups = channel.groups ?? [];
    if (groupId) return groups.find((group) => group.id === groupId);
    if (channel.defaultGroupId) {
      const fallback = groups.find((group) => group.id === channel.defaultGroupId);
      if (fallback) return fallback;
    }
    return groups[0];
  }

  function pickKey(keys: readonly string[], keyMode: string, cursorKey: string): string {
    if (keyMode === "random") {
      return keys[Math.floor(Math.random() * keys.length)]!;
    }
    if (keyMode === "polling") {
      const next = (pollingCursors.get(cursorKey) ?? 0) % keys.length;
      pollingCursors.set(cursorKey, next + 1);
      return keys[next]!;
    }
    return keys[0]!;
  }

  return {
    async listChannels(): Promise<readonly RelayChannelView[]> {
      const providers = await readChannelProviders();
      const views: RelayChannelView[] = [];
      for (const provider of providers) {
        views.push(await toView(provider.providerId, provider.providerName, provider.config));
      }
      return Object.freeze(views);
    },

    async saveChannel(input: SaveRelayChannelInput): Promise<RelayChannelView> {
      const parsed = saveRelayChannelInputSchema.parse(input);
      const snapshot = await configService.read();
      let providerId = parsed.providerId?.trim();
      let current: ProviderConfig | undefined;
      if (providerId) {
        const rule = snapshot.personalProviders.getRule(providerId);
        if (!rule) throw new Error(`Personal Provider 不存在: ${providerId}`);
        current = rule.config;
      }
      if (!providerId) {
        const created = await configService.createPersonalProvider({
          providerName: parsed.providerName?.trim() || "relay-channel",
        });
        providerId = created.providerId;
      }
      const existingChannel = current?.channel ?? {};
      const nextChannel: RelayChannel = Object.freeze({
        name: parsed.providerName?.trim() || existingChannel.name || undefined,
        baseUrl:
          parsed.baseUrl !== undefined ? parsed.baseUrl : (existingChannel.baseUrl ?? undefined),
        status: parsed.status ?? existingChannel.status ?? undefined,
        groups:
          parsed.groups !== undefined
            ? [...parsed.groups]
            : existingChannel.groups
              ? [...existingChannel.groups]
              : null,
        defaultGroupId:
          parsed.defaultGroupId !== undefined
            ? parsed.defaultGroupId
            : (existingChannel.defaultGroupId ?? null),
      });
      const groupModels = new Set<string>();
      for (const group of nextChannel.groups ?? []) {
        for (const model of group.models ?? []) groupModels.add(model);
      }
      const mergedModelIds = [...(current?.personalModelIds ?? []), ...groupModels];
      const nextConfig = (current ?? new ProviderConfig()).overlay(
        new ProviderConfig({
          group: "standard-personal",
          access: current?.access ?? new ApiKeyAccessConfig(),
          api: new ProviderApiConfig({
            type: current?.api?.type ?? "openai-chat-completions",
            baseUrl:
              parsed.baseUrl !== undefined
                ? (parsed.baseUrl ?? undefined)
                : (current?.api?.baseUrl ?? undefined),
            headers: current?.api?.headers ?? undefined,
          }),
          channel: nextChannel,
          personalModelIds: mergedModelIds,
          modelOrder: current?.modelOrder ?? [],
        }),
      );
      await configService.savePersonalProviderOverlay(
        providerId,
        nextConfig,
        undefined,
        parsed.providerName?.trim() ? { providerName: parsed.providerName.trim() } : undefined,
      );
      // 写一次语义：未传 apiKeys 即保留旧密钥，只有显式传入才覆盖（含空数组=清空）。
      if (parsed.apiKeys !== undefined) {
        await credentialService.save(credentialKeyFor(providerId), JSON.stringify(parsed.apiKeys));
      }
      const refreshed = await configService.read();
      const rule = refreshed.personalProviders.getRule(providerId);
      if (!rule) throw new Error(`Personal Provider 保存后丢失: ${providerId}`);
      return toView(providerId, rule.providerName ?? providerId, rule.config);
    },

    async deleteChannel(providerId: string): Promise<void> {
      const id = providerId.trim();
      if (!id) throw new Error("providerId 不能为空");
      await configService.deletePersonalProvider(id);
      await credentialService.delete(credentialKeyFor(id)).catch(() => undefined);
      pollingCursors.delete(id);
    },

    async fetchChannelModels(input: FetchRelayChannelModelsInput): Promise<readonly string[]> {
      const parsed = fetchRelayChannelModelsInputSchema.parse(input);
      const snapshot = await configService.read();
      const rule = snapshot.personalProviders.getRule(parsed.providerId);
      const channel = rule?.config.channel;
      if (!rule || !channel) throw new Error(`中转渠道不存在: ${parsed.providerId}`);
      const group = pickGroup(channel, parsed.groupId);
      const keys = await loadKeys(parsed.providerId);
      // 免费渠道无 key 即可拉取（Kilo /models 无需鉴权）；普通渠道缺 key 抛错。
      const apiKey = keys[0] ?? "";
      const isFree = channel.free === true;
      if (!apiKey && !isFree) throw new Error(`渠道尚未配置密钥: ${parsed.providerId}`);
      const baseUrl = (group?.baseUrl ?? channel.baseUrl ?? rule.config.api?.baseUrl ?? "").replace(
        /\/$/,
        "",
      );
      if (!baseUrl) throw new Error(`渠道缺少 baseUrl: ${parsed.providerId}`);
      const response = await fetch(`${baseUrl}/models`, {
        headers: {
          Accept: "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          ...(isFree ? { "User-Agent": KILO_USER_AGENT } : {}),
        },
        signal: AbortSignal.timeout(MODELS_FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`上游模型发现失败: ${response.status}`);
      }
      const models = extractModelIds(await response.json());
      if (parsed.selectedModels !== undefined) {
        const unknown = parsed.selectedModels.filter((model) => !models.includes(model));
        if (unknown.length > 0) {
          throw new Error(`选中的模型不在上游返回中: ${unknown.slice(0, 8).join(", ")}`);
        }
      }
      if (parsed.save !== false) {
        // 成员变更必须走差分同步（见 syncPersonalModels 注释），overlay 里的名单会被丢弃。
        const picked = parsed.selectedModels ?? models;
        const ruleNow = (await configService.read()).personalProviders.getRule(parsed.providerId);
        await syncPersonalModels(configService, parsed.providerId, [
          ...(ruleNow?.config.personalModelIds ?? []),
          ...picked,
        ]);
      }
      return Object.freeze(models);
    },

    async resolveRelayTarget(input: ResolveRelayTargetInput): Promise<ResolvedRelayTarget> {
      const parsed = resolveRelayTargetInputSchema.parse(input);
      const snapshot = await configService.read();
      const rule = snapshot.personalProviders.getRule(parsed.providerId);
      const channel = rule?.config.channel;
      if (!rule || !channel) throw new Error(`中转渠道不存在: ${parsed.providerId}`);
      if ((channel.status ?? "enabled") !== "enabled") {
        throw new Error(`中转渠道已禁用: ${parsed.providerId}`);
      }
      const group = pickGroup(channel, parsed.groupId);
      if (!group) throw new Error(`渠道没有可用分组: ${parsed.providerId}`);
      if ((group.status ?? "enabled") !== "enabled") {
        throw new Error(`渠道分组已禁用: ${parsed.providerId}/${group.id}`);
      }
      const keys = await loadKeys(parsed.providerId);
      const isFree = channel.free === true;
      // 免费渠道无 key 可执行（执行层本就支持无 Authorization 头）；
      // 普通渠道无可用 key 时抛错而不是 fallback，不静默走错路由。
      if (!isFree && keys.length === 0) throw new Error(`渠道尚未配置密钥: ${parsed.providerId}`);
      const apiKey =
        keys.length > 0
          ? pickKey(keys, group.keyMode ?? "single", `${parsed.providerId}:${group.id}`)
          : "";
      const baseUrl = (group.baseUrl ?? channel.baseUrl ?? rule.config.api?.baseUrl ?? "").replace(
        /\/$/,
        "",
      );
      if (!baseUrl) throw new Error(`渠道缺少 baseUrl: ${parsed.providerId}`);
      return {
        baseUrl,
        apiKey,
        protocol: group.responseProtocol ?? "openai",
        groupId: group.id,
        groupRatio: group.groupRatio ?? 1,
      };
    },

    /**
     * Kilo 免费渠道补种（P4，幂等，永不抛错）：
     * 缺失或 channel 被删时重建；已有 channel 不覆盖用户改动，只补模型。
     */
    async ensureKiloFreeChannel(): Promise<RelayChannelView | null> {
      return ensureKiloFreeChannelImpl({
        configService,
        buildView: toView,
        syncModels: (providerId, wanted) => syncPersonalModels(configService, providerId, wanted),
      });
    },

    async getThreadSelection(threadId: string): Promise<RelayChannelSelection | null> {
      const selection = await threadSelections.get(threadId);
      if (!selection) return null;
      // 渠道删除后旧选择失效：读时校验，不崩不保留。
      const snapshot = await configService.read();
      const rule = snapshot.personalProviders.getRule(selection.providerId);
      if (!rule || rule.config.channel == null) return null;
      return selection;
    },

    async setThreadSelection(
      threadId: string,
      selection: RelayChannelSelection | null,
    ): Promise<RelayChannelSelection | null> {
      return threadSelections.set(threadId, selection);
    },
  };
}

function extractModelIds(payload: unknown): string[] {
  const containers: unknown[] = [];
  if (typeof payload === "object" && payload !== null) {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record["data"])) containers.push(...record["data"]);
    if (Array.isArray(record["models"])) containers.push(...record["models"]);
  }
  if (Array.isArray(payload)) containers.push(...payload);
  const ids: string[] = [];
  for (const item of containers.slice(0, MAX_MODELS_PER_FETCH)) {
    if (typeof item === "string" && item) ids.push(item);
    else if (typeof item === "object" && item !== null) {
      const record = item as Record<string, unknown>;
      const id = record["id"] ?? record["name"];
      if (typeof id === "string" && id) ids.push(id);
    }
  }
  return [...new Set(ids)];
}
