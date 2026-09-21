import type {
  RelayChannelResponseProtocol,
  RelayChannelView,
} from "./relay-channel-schema.js";

/** 内置保留名（移植 ultra relayNameValidation 语义，适配 ZCode 渠道视图）。 */
const BUILT_IN_RELAY_NAMES = [
  "openai",
  "deepseek",
  "deepkey",
  "linuxdo",
  "gemini",
  "anthropic",
  "google",
] as const;

/** 归一化：去空白/大小写/分隔符 + 去尾缀（中转站?|relay|channel）。 */
// ultra 的 relayNameConflict 当时未接入调用，这里作为设置保存前的显式校验使用。
export function normalizeRelayName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "")
    .replace(/(?:中转站?|relay|channel)$/i, "");
}

/** 重名即冲突（含内置保留名），返回冲突的渠道名或保留名，无冲突返回 null。 */
export function relayNameConflict(
  name: string,
  channels: readonly Pick<RelayChannelView, "providerId" | "providerName">[],
  excludeProviderId?: string,
): string | null {
  const normalized = normalizeRelayName(name);
  if (!normalized) return null;
  if (BUILT_IN_RELAY_NAMES.some((reserved) => normalizeRelayName(reserved) === normalized)) {
    return name.trim();
  }
  for (const channel of channels) {
    if (excludeProviderId && channel.providerId === excludeProviderId) continue;
    for (const candidate of [channel.providerId, channel.providerName]) {
      if (typeof candidate === "string" && normalizeRelayName(candidate) === normalized) {
        return channel.providerName;
      }
    }
  }
  return null;
}

/** 按 baseUrl 推断协议，仅做新建默认值，不改已存值。 */
export function inferRelayProtocol(baseUrl: string): RelayChannelResponseProtocol {
  const lower = baseUrl.trim().toLowerCase();
  if (!lower) return "openai";
  if (lower.includes("anthropic")) return "anthropic";
  if (lower.includes("gemini") || lower.includes("googleapis")) return "gemini";
  if (lower.includes("response") || lower.includes("responses")) return "openai-response";
  return "openai";
}
