import type { RelayChannelView } from "@zcode/services";

export interface GroupDraft {
  id: string;
  name: string;
  baseUrl: string;
  status: "enabled" | "disabled";
  groupRatio: string;
  keyMode: "single" | "random" | "polling";
  responseProtocol: "openai" | "openai-response" | "anthropic" | "gemini";
  modelsText: string;
}

export interface ChannelDraft {
  providerId?: string;
  providerName: string;
  baseUrl: string;
  status: "enabled" | "disabled";
  apiKeysText: string;
  defaultGroupId: string;
  groups: GroupDraft[];
}

export const EMPTY_DRAFT: ChannelDraft = {
  providerName: "",
  baseUrl: "",
  status: "enabled",
  apiKeysText: "",
  defaultGroupId: "",
  groups: [
    {
      id: "default",
      name: "default",
      baseUrl: "",
      status: "enabled",
      groupRatio: "1",
      keyMode: "single",
      responseProtocol: "openai",
      modelsText: "",
    },
  ],
};

export function toChannelDraft(view?: RelayChannelView): ChannelDraft {
  if (!view)
    return { ...EMPTY_DRAFT, groups: EMPTY_DRAFT.groups.map((group) => ({ ...group })) };
  return {
    providerId: view.providerId,
    providerName: view.providerName,
    baseUrl: view.baseUrl ?? "",
    status: view.status,
    apiKeysText: "",
    defaultGroupId: view.defaultGroupId ?? "",
    groups: view.groups.map((group) => ({
      id: group.groupId,
      name: group.groupName,
      baseUrl: group.baseUrl ?? "",
      status: group.status,
      groupRatio: String(group.groupRatio),
      keyMode: group.keyMode ?? "single",
      responseProtocol: group.responseProtocol ?? "openai",
      modelsText: group.models.join("\n"),
    })),
  };
}

export function parseModels(text: string): string[] {
  return [
    ...new Set(
      text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ];
}

export function parseKeys(text: string): string[] {
  return [
    ...new Set(
      text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ];
}
