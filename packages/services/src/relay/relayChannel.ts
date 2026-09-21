import { z } from "zod";
import {
  relayChannelGroupSchema,
  relayChannelResponseProtocolSchema,
  relayChannelSelectionSchema,
  type RelayChannelGroup,
  type RelayChannelResponseProtocol,
  type RelayChannelSelection,
  type RelayChannelStatus,
  type RelayChannelView,
} from "@zcode/provider";
import { createServiceDescriptor, type ServiceDescriptor } from "../descriptors.js";

export const IRelayChannelService: ServiceDescriptor<IRelayChannelService> =
  createServiceDescriptor<IRelayChannelService>("relayChannel");

const nonBlankString = z.string().min(1);

/** 新建/更新渠道。apiKeys 缺省 = 保留旧密钥（写一次语义）。 */
export const saveRelayChannelInputSchema = z
  .object({
    providerId: nonBlankString.optional(),
    providerName: z.string().min(1).max(80).optional(),
    baseUrl: z.string().url().nullable().optional(),
    status: z.enum(["enabled", "disabled"]).optional(),
    apiKeys: z.array(z.string().min(1)).max(16).optional(),
    defaultGroupId: z.string().min(1).nullable().optional(),
    groups: z.array(relayChannelGroupSchema).max(64).optional(),
  })
  .strict();

export type SaveRelayChannelInput = z.infer<typeof saveRelayChannelInputSchema>;

export const fetchRelayChannelModelsInputSchema = z
  .object({
    providerId: nonBlankString,
    groupId: z.string().min(1).nullable().optional(),
    selectedModels: z.array(z.string().min(1)).max(500).optional(),
    save: z.boolean().optional(),
  })
  .strict();

export type FetchRelayChannelModelsInput = z.infer<typeof fetchRelayChannelModelsInputSchema>;

export const resolveRelayTargetInputSchema = z
  .object({
    providerId: nonBlankString,
    groupId: z.string().min(1).nullable().optional(),
    model: z.string().min(1).nullable().optional(),
  })
  .strict();

export type ResolveRelayTargetInput = z.infer<typeof resolveRelayTargetInputSchema>;

export interface ResolvedRelayTarget {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly protocol: RelayChannelResponseProtocol;
  readonly groupId: string;
  readonly groupRatio: number;
}

export interface IRelayChannelService {
  listChannels(): Promise<readonly RelayChannelView[]>;
  saveChannel(input: SaveRelayChannelInput): Promise<RelayChannelView>;
  deleteChannel(providerId: string): Promise<void>;
  fetchChannelModels(input: FetchRelayChannelModelsInput): Promise<readonly string[]>;
  resolveRelayTarget(input: ResolveRelayTargetInput): Promise<ResolvedRelayTarget>;
  getThreadSelection(threadId: string): Promise<RelayChannelSelection | null>;
  setThreadSelection(
    threadId: string,
    selection: RelayChannelSelection | null,
  ): Promise<RelayChannelSelection | null>;
}

export type {
  RelayChannelGroup,
  RelayChannelResponseProtocol,
  RelayChannelSelection,
  RelayChannelStatus,
  RelayChannelView,
};
export { relayChannelSelectionSchema };
