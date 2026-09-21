import {
  ApiKeyAccessConfig,
  ProviderApiConfig,
  ProviderConfig,
  type RelayChannelView,
} from "@zcode/provider";
import { createServiceLogger } from "../logger/serviceLogger.js";
import type { ProviderConfigRuntime } from "../model-provider/providerConfigRuntime.js";

/**
 * Kilo 免费渠道常量、纯函数与补种实现（P4，移植 ultra omniRouteFree kilocode）。
 * 无 key 的 OpenRouter 兼容端点；模型发现过滤 isFree 或 :free/-free 后缀。
 */

const logger = createServiceLogger("relayChannelService");

/** Kilo 免费渠道（personal provider 名）。 */
export const KILO_FREE_PROVIDER_NAME = "Kilo 免费";
export const KILOCODE_FREE_BASE_URL = "https://api.kilo.ai/api/openrouter";
export const KILOCODE_GROUP_ID = "kilocode";
export const KILO_USER_AGENT = "opencode-kilo-provider";
export const KILO_FETCH_TIMEOUT_MS = 10000;
/**
 * 首启 fallback 模型（实测 2026-09-21，21 个免费中的 3 个）：
 * 门禁只在启动时评估一次，同步种子保证首启即有模型；后台刷新成功即替换为实时列表。
 */
export const KILO_FALLBACK_MODELS: readonly string[] = Object.freeze([
  "kilo-auto/free",
  "qwen/qwen3.8-27b:free",
  "z-ai/glm-5.2:free",
]);

/**
 * Kilo 免费模型过滤（移植 ultra eligibleKiloCodeFreeModels）。
 * 纯函数，可单测。
 */
export function eligibleKiloFreeModels(payload: unknown): string[] {
  const entries = Array.isArray(payload)
    ? payload
    : typeof payload === "object" &&
        payload !== null &&
        Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const entry of entries) {
    const record =
      typeof entry === "string"
        ? { id: entry }
        : typeof entry === "object" && entry !== null && !Array.isArray(entry)
          ? (entry as Record<string, unknown>)
          : {};
    const id = typeof record["id"] === "string" ? (record["id"] as string).trim() : "";
    const normalized = id.toLowerCase();
    if (!id || seen.has(normalized)) continue;
    const isFree =
      (record as Record<string, unknown>)["isFree"] === true ||
      normalized.endsWith(":free") ||
      normalized.endsWith("-free");
    if (!isFree) continue;
    seen.add(normalized);
    ids.push(id);
  }
  return ids;
}

export async function fetchKiloFreeModelIds(fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const response = await fetchImpl(`${KILOCODE_FREE_BASE_URL}/models`, {
    headers: { Accept: "application/json", "User-Agent": KILO_USER_AGENT },
    signal: AbortSignal.timeout(KILO_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Kilo 免费模型发现失败: ${response.status}`);
  return eligibleKiloFreeModels(await response.json());
}

export interface KiloEnsureDeps {
  readonly configService: ProviderConfigRuntime["configService"];
  readonly buildView: (
    providerId: string,
    providerName: string,
    config: ProviderConfig,
  ) => Promise<RelayChannelView>;
  /** 成员同步（必须走差分，overlay 名单会被领域丢弃）。 */
  readonly syncModels: (providerId: string, wanted: readonly string[]) => Promise<void>;
}

/**
 * Kilo 免费渠道补种（幂等，永不抛错）：
 * 缺失或 channel 被删时重建；已有 channel 不覆盖用户改动，只补模型。
 */
export async function ensureKiloFreeChannelImpl(
  deps: KiloEnsureDeps,
): Promise<RelayChannelView | null> {
  const { configService, buildView, syncModels } = deps;
  try {
    const findFreeRule = async () => {
      // createPersonalProvider 不接受固定 id（防重名由领域保证），
      // 因此按 channel.free 查找而不是按 id；用户删除后即缺席，下次重建。
      const snapshot = await configService.read();
      return snapshot.personalProviders.rules().find((rule) => rule.config.channel?.free === true);
    };
    const rule = await findFreeRule();
    let providerId = rule?.providerId;
    if (!providerId) {
      const created = await configService.createPersonalProvider({
        providerName: KILO_FREE_PROVIDER_NAME,
      });
      providerId = created.providerId;
    }
    const current = (await configService.read()).personalProviders.getRule(providerId);
    if (!current) return null;
    if (current.config.channel == null) {
      // 只补骨架：group/模型/密钥语义沿用 free 约定，其余字段不动。
      const skeleton = current.config.overlay(
        new ProviderConfig({
          group: "standard-personal",
          access: current.config.access ?? new ApiKeyAccessConfig(),
          api: new ProviderApiConfig({
            type: "openai-chat-completions",
            baseUrl: KILOCODE_FREE_BASE_URL,
            headers: { "User-Agent": KILO_USER_AGENT },
          }),
          channel: {
            name: KILO_FREE_PROVIDER_NAME,
            baseUrl: KILOCODE_FREE_BASE_URL,
            status: "enabled",
            free: true,
            groups: [
              {
                id: KILOCODE_GROUP_ID,
                name: "KiloCode",
                status: "enabled",
                groupRatio: 0,
                keyMode: "single",
                models: [...KILO_FALLBACK_MODELS],
                responseProtocol: "openai",
              },
            ],
          },
          personalModelIds: current.config.personalModelIds ?? [],
          modelOrder: current.config.modelOrder ?? [],
        }),
      );
      await configService.savePersonalProviderOverlay(providerId, skeleton, undefined, {
        providerName: current.providerName ?? KILO_FREE_PROVIDER_NAME,
      });
      // 首启同步种子：门禁只评估一次，先给 fallback 模型保证免登录进入，
      // 后台刷新成功再替换为实时列表。
      const seeded = (await configService.read()).personalProviders.getRule(providerId);
      if (seeded && (seeded.config.personalModelIds ?? []).length === 0) {
        await syncModels(providerId, [...KILO_FALLBACK_MODELS]);
      }
    }
    // 模型刷新：失败即跳过（离线退化为今日行为），成功替换为实时列表。
    const fresh = await fetchKiloFreeModelIds().catch((error: unknown) => {
      logger.warn(undefined, "Kilo 免费模型刷新失败，保留既有模型", {
        error: error instanceof Error ? error.message : String(error),
      });
      return [] as string[];
    });
    const latest = (await configService.read()).personalProviders.getRule(providerId);
    if (!latest) return null;
    if (fresh.length > 0) {
      // 实时列表同时写入分组模型（chips 展示，overlay 可持久化）与
      // personalModelIds（registry/门禁用，必须走差分同步）。
      const channel = latest.config.channel ?? {};
      const nextConfig = latest.config.overlay(
        new ProviderConfig({
          channel: {
            ...channel,
            groups: (channel.groups ?? []).map((group) =>
              group.id === KILOCODE_GROUP_ID ? { ...group, models: [...fresh] } : group,
            ),
          },
        }),
      );
      await configService.savePersonalProviderOverlay(providerId, nextConfig);
      await syncModels(providerId, fresh);
      const refreshed = (await configService.read()).personalProviders.getRule(providerId);
      if (refreshed) {
        return buildView(providerId, refreshed.providerName ?? providerId, refreshed.config);
      }
    }
    return buildView(providerId, latest.providerName ?? providerId, latest.config);
  } catch (error: unknown) {
    // 补种永不阻断启动：离线/磁盘异常都退化为无免费渠道。
    logger.warn(undefined, "Kilo 免费渠道补种失败", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
