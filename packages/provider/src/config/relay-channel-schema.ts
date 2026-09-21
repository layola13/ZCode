import { z } from "zod";

/** 中转渠道 Key 使用策略：single 首个可用，random 随机，polling 按序轮换。 */
export const relayChannelKeyModeSchema = z.enum(["single", "random", "polling"]);

export const relayChannelStatusSchema = z.enum(["enabled", "disabled"]);

/** 上游协议：决定执行侧请求改写，不决定 UI。 */
export const relayChannelResponseProtocolSchema = z.enum([
  "openai-response",
  "openai",
  "anthropic",
  "gemini",
]);

const nonBlankString = z.string().min(1);
const optionalUrl = z.string().url().nullable().optional();

export const relayChannelGroupSchema = z
  .object({
    id: nonBlankString,
    name: nonBlankString,
    baseUrl: optionalUrl,
    status: relayChannelStatusSchema.optional(),
    // 0 = 免费（P4 Kilo，不计费）；>0 为倍率。
    groupRatio: z.number().nonnegative().nullable().optional(),
    keyMode: relayChannelKeyModeSchema.optional(),
    models: z.array(z.string().min(1)).readonly().nullable().optional(),
    responseProtocol: relayChannelResponseProtocolSchema.optional(),
    contextWindow: z.number().int().positive().nullable().optional(),
  })
  .strict();

export const relayChannelSchema = z
  .object({
    name: z.string().nullable().optional(),
    baseUrl: optionalUrl,
    status: relayChannelStatusSchema.optional(),
    // free 渠道（P4 Kilo）：不需要密钥即可执行；completeness 豁免 access.apiKey，
    // resolve 返回空 key（执行层本就支持无 Authorization 头）。
    free: z.boolean().optional(),
    groups: z.array(relayChannelGroupSchema).readonly().nullable().optional(),
    defaultGroupId: z.string().min(1).nullable().optional(),
    trashedAt: z.string().nullable().optional(),
  })
  .strict();

export type RelayChannelKeyMode = z.infer<typeof relayChannelKeyModeSchema>;
export type RelayChannelStatus = z.infer<typeof relayChannelStatusSchema>;
export type RelayChannelResponseProtocol = z.infer<typeof relayChannelResponseProtocolSchema>;
export type RelayChannelGroup = Readonly<z.infer<typeof relayChannelGroupSchema>>;
export type RelayChannel = Readonly<z.infer<typeof relayChannelSchema>>;

/** per-thread 选择：服务端权威，UI 只做缓存。 */
export const relayChannelSelectionSchema = z
  .object({
    providerId: nonBlankString,
    groupId: z.string().min(1).nullable().optional(),
    model: z.string().min(1).nullable().optional(),
  })
  .strict();

export type RelayChannelSelection = Readonly<z.infer<typeof relayChannelSelectionSchema>>;

function maskKey(key: string): string {
  const tail = key.slice(-4);
  return `••••${tail}`;
}

export function previewRelayKey(key: string): string {
  return maskKey(key);
}

/** 脱敏后的分组视图：永远不含明文 key。P1.1 加法扩展 keyMode/responseProtocol/baseUrl，用于编辑回填不丢字段。 */
export interface RelayChannelGroupView {
  readonly groupId: string;
  readonly groupName: string;
  readonly groupRatio: number;
  readonly status: RelayChannelStatus;
  readonly models: readonly string[];
  readonly apiKeyConfigured: boolean;
  readonly keyMode?: RelayChannelKeyMode;
  readonly responseProtocol?: RelayChannelResponseProtocol;
  readonly baseUrl?: string;
}

export interface RelayChannelView {
  readonly providerId: string;
  readonly providerName: string;
  readonly baseUrl?: string;
  readonly status: RelayChannelStatus;
  readonly apiKeyConfigured: boolean;
  readonly apiKeyPreview?: string;
  readonly defaultGroupId?: string;
  readonly groups: readonly RelayChannelGroupView[];
}

export function toRelayChannelGroupView(
  group: RelayChannelGroup,
  apiKeyConfigured: boolean,
): RelayChannelGroupView {
  return {
    groupId: group.id,
    groupName: group.name,
    groupRatio: group.groupRatio ?? 1,
    status: group.status ?? "enabled",
    models: Object.freeze([...(group.models ?? [])]),
    apiKeyConfigured,
    keyMode: group.keyMode ?? "single",
    responseProtocol: group.responseProtocol ?? "openai",
    ...(group.baseUrl ? { baseUrl: group.baseUrl } : {}),
  };
}
