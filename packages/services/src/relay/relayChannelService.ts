import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { atomicWritePrivateTextFile, withFileLock } from "@zcode/shared/node";
import {
  ApiKeyAccessConfig,
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
  relayChannelSelectionSchema,
  type FetchRelayChannelModelsInput,
  type IRelayChannelService,
  type ResolveRelayTargetInput,
  type ResolvedRelayTarget,
  type SaveRelayChannelInput,
} from "./relayChannel.js";

const logger = createServiceLogger("relayChannelService");
const MODELS_FETCH_TIMEOUT_MS = 12000;
const MAX_MODELS_PER_FETCH = 2000;

export interface RelayChannelServiceOptions {
  readonly configService: ProviderConfigRuntime["configService"];
  readonly credentialService: ICredentialService;
  readonly dataDir?: string;
}

interface ThreadSelectionFile {
  readonly version: 1;
  readonly selections: Record<string, RelayChannelSelection>;
}

function credentialKeyFor(providerId: string): string {
  return `relay-channel:${providerId}`;
}

function selectionFilePath(dataDir: string): string {
  return join(dataDir, "relay", "thread-relay-selection.json");
}

async function readSelectionFile(filePath: string): Promise<ThreadSelectionFile> {
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, "utf-8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as { version?: unknown }).version === 1 &&
      typeof (parsed as { selections?: unknown }).selections === "object"
    ) {
      return parsed as ThreadSelectionFile;
    }
  } catch {
    // 缺失或损坏都视为空选择；损坏文件不自动覆盖，由下次写入替换。
  }
  return { version: 1, selections: {} };
}

export function createRelayChannelService(
  options: RelayChannelServiceOptions,
): IRelayChannelService {
  const dataDir = options.dataDir ?? getAppConfigDir();
  const { configService, credentialService } = options;
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
      await configService.savePersonalProviderOverlay(providerId, nextConfig, undefined, {
        ...(parsed.providerName?.trim() ? { providerName: parsed.providerName.trim() } : {}),
      });
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
      const apiKey = keys[0];
      if (!apiKey) throw new Error(`渠道尚未配置密钥: ${parsed.providerId}`);
      const baseUrl = (group?.baseUrl ?? channel.baseUrl ?? rule.config.api?.baseUrl ?? "").replace(
        /\/$/,
        "",
      );
      if (!baseUrl) throw new Error(`渠道缺少 baseUrl: ${parsed.providerId}`);
      const response = await fetch(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
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
        const picked = parsed.selectedModels ?? models;
        const nextConfig = rule.config.overlay(
          new ProviderConfig({
            personalModelIds: [...new Set([...(rule.config.personalModelIds ?? []), ...picked])],
          }),
        );
        await configService.savePersonalProviderOverlay(parsed.providerId, nextConfig);
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
      if (keys.length === 0) throw new Error(`渠道尚未配置密钥: ${parsed.providerId}`);
      // 无可用 key 时抛错而不是 fallback：调用方必须显式处理，不静默走错路由。
      const apiKey = pickKey(keys, group.keyMode ?? "single", `${parsed.providerId}:${group.id}`);
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

    async getThreadSelection(threadId: string): Promise<RelayChannelSelection | null> {
      const id = threadId.trim();
      if (!id) return null;
      const file = await readSelectionFile(selectionFilePath(dataDir));
      const selection = file.selections[id];
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
      const id = threadId.trim();
      if (!id) throw new Error("threadId 不能为空");
      const parsed = selection == null ? null : relayChannelSelectionSchema.parse(selection);
      const filePath = selectionFilePath(dataDir);
      await withFileLock(filePath, async () => {
        const file = await readSelectionFile(filePath);
        const selections = { ...file.selections };
        if (parsed == null) delete selections[id];
        else selections[id] = parsed;
        await atomicWritePrivateTextFile(
          filePath,
          `${JSON.stringify({ version: 1, selections }, null, 2)}\n`,
        );
      });
      return parsed;
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
