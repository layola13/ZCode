import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button.js";
import { useRelayChannels } from "@/hooks/useRelayChannels.js";
import type { RelayChannelView } from "@zcode/services";

interface GroupDraft {
  id: string;
  name: string;
  baseUrl: string;
  groupRatio: string;
  keyMode: "single" | "random" | "polling";
  responseProtocol: "openai" | "openai-response" | "anthropic" | "gemini";
  modelsText: string;
}

interface ChannelDraft {
  providerId?: string;
  providerName: string;
  baseUrl: string;
  status: "enabled" | "disabled";
  apiKeysText: string;
  defaultGroupId: string;
  groups: GroupDraft[];
}

const EMPTY_DRAFT: ChannelDraft = {
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
      groupRatio: "1",
      keyMode: "single",
      responseProtocol: "openai",
      modelsText: "",
    },
  ],
};

function toDraft(view?: RelayChannelView): ChannelDraft {
  if (!view) return { ...EMPTY_DRAFT, groups: EMPTY_DRAFT.groups.map((group) => ({ ...group })) };
  return {
    providerId: view.providerId,
    providerName: view.providerName,
    baseUrl: view.baseUrl ?? "",
    status: view.status,
    apiKeysText: "",
    defaultGroupId: "",
    groups: view.groups.map((group) => ({
      id: group.groupId,
      name: group.groupName,
      baseUrl: "",
      groupRatio: String(group.groupRatio),
      keyMode: "single",
      responseProtocol: "openai",
      modelsText: group.models.join("\n"),
    })),
  };
}

function parseModels(text: string): string[] {
  return [
    ...new Set(
      text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ];
}

export function RelayChannelSection() {
  const { available, loading, error, channels, saveChannel, deleteChannel, fetchModels } =
    useRelayChannels();
  const [editing, setEditing] = useState<ChannelDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fetching, setFetching] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const sorted = useMemo(
    () => [...channels].sort((a, b) => a.providerName.localeCompare(b.providerName)),
    [channels],
  );

  if (!available) {
    return <p className="text-ui-sm text-foreground-subtle">当前 Host 不支持中转渠道管理。</p>;
  }

  async function handleSave() {
    if (!editing) return;
    setSaving(true);
    setFormError(null);
    try {
      const ratio = (text: string) => {
        const value = Number(text);
        return Number.isFinite(value) && value > 0 ? value : 1;
      };
      await saveChannel({
        ...(editing.providerId ? { providerId: editing.providerId } : {}),
        providerName: editing.providerName.trim() || undefined,
        baseUrl: editing.baseUrl.trim() || null,
        status: editing.status,
        ...(editing.apiKeysText.trim() ? { apiKeys: [editing.apiKeysText.trim()] } : {}),
        defaultGroupId: editing.defaultGroupId.trim() || null,
        groups: editing.groups
          .filter((group) => group.id.trim())
          .map((group) => ({
            id: group.id.trim(),
            name: group.name.trim() || group.id.trim(),
            baseUrl: group.baseUrl.trim() || null,
            status: "enabled" as const,
            groupRatio: ratio(group.groupRatio),
            keyMode: group.keyMode,
            models: parseModels(group.modelsText),
            responseProtocol: group.responseProtocol,
          })),
      });
      setEditing(null);
    } catch (error: unknown) {
      setFormError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  async function handleFetch(providerId: string, groupId: string) {
    setFetching(`${providerId}:${groupId}`);
    setFormError(null);
    try {
      await fetchModels(providerId, groupId);
    } catch (error: unknown) {
      setFormError(error instanceof Error ? error.message : String(error));
    } finally {
      setFetching(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-ui-sm text-foreground-subtle">
          第三方中转渠道（baseUrl + 密钥 + 分组 + 倍率）。密钥只写不读，留空即保留。
        </p>
        <Button
          size="sm"
          onClick={() => {
            setEditing(toDraft());
            setFormError(null);
          }}
        >
          新建渠道
        </Button>
      </div>
      {error ? <p className="text-ui-sm text-destructive">{error}</p> : null}
      {formError ? <p className="text-ui-sm text-destructive">{formError}</p> : null}
      {loading && channels.length === 0 ? (
        <p className="text-ui-sm text-foreground-subtle">加载中…</p>
      ) : null}
      {sorted.map((channel) => (
        <div key={channel.providerId} className="rounded-lg border border-border p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-ui-base font-medium">{channel.providerName}</span>
              <span className="text-ui-xs text-foreground-subtle">
                {channel.status === "enabled" ? "启用" : "禁用"} ·{" "}
                {channel.apiKeyConfigured
                  ? `密钥已配置${channel.apiKeyPreview ? `（${channel.apiKeyPreview}）` : ""}`
                  : "未配置密钥"}
              </span>
            </div>
            <div className="flex gap-2">
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  setEditing(toDraft(channel));
                  setFormError(null);
                }}
              >
                编辑
              </Button>
              {confirmDelete === channel.providerId ? (
                <Button
                  size="xs"
                  variant="destructive"
                  onClick={() => {
                    void deleteChannel(channel.providerId);
                    setConfirmDelete(null);
                  }}
                >
                  确认删除
                </Button>
              ) : (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => setConfirmDelete(channel.providerId)}
                >
                  删除
                </Button>
              )}
            </div>
          </div>
          <div className="mt-2 flex flex-col gap-1">
            {channel.groups.map((group) => (
              <div key={group.groupId} className="flex items-center justify-between text-ui-sm">
                <span>
                  {group.groupName} · ×{group.groupRatio} · {group.models.length} 个模型
                </span>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={fetching === `${channel.providerId}:${group.groupId}`}
                  onClick={() => void handleFetch(channel.providerId, group.groupId)}
                >
                  {fetching === `${channel.providerId}:${group.groupId}` ? "同步中…" : "同步模型"}
                </Button>
              </div>
            ))}
            {channel.groups.length === 0 ? (
              <span className="text-ui-sm text-foreground-subtle">暂无分组，先编辑添加。</span>
            ) : null}
          </div>
        </div>
      ))}
      {editing ? (
        <div className="rounded-lg border border-border p-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-ui-sm">
              名称
              <input
                className="rounded-md border border-input bg-input px-2 py-1 text-ui-sm"
                value={editing.providerName}
                onChange={(event) => setEditing({ ...editing, providerName: event.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-ui-sm">
              Base URL
              <input
                className="rounded-md border border-input bg-input px-2 py-1 text-ui-sm"
                value={editing.baseUrl}
                placeholder="https://relay.example/v1"
                onChange={(event) => setEditing({ ...editing, baseUrl: event.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-ui-sm">
              状态
              <select
                className="rounded-md border border-input bg-input px-2 py-1 text-ui-sm"
                value={editing.status}
                onChange={(event) =>
                  setEditing({ ...editing, status: event.target.value as "enabled" | "disabled" })
                }
              >
                <option value="enabled">启用</option>
                <option value="disabled">禁用</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-ui-sm">
              密钥（留空保留旧密钥）
              <input
                type="password"
                className="rounded-md border border-input bg-input px-2 py-1 text-ui-sm"
                value={editing.apiKeysText}
                onChange={(event) => setEditing({ ...editing, apiKeysText: event.target.value })}
              />
            </label>
          </div>
          <div className="mt-2 flex flex-col gap-2">
            {editing.groups.map((group, index) => (
              <div key={index} className="grid grid-cols-3 gap-2 rounded-md bg-surface p-2">
                <input
                  className="rounded-md border border-input bg-input px-2 py-1 text-ui-sm"
                  placeholder="分组 id"
                  value={group.id}
                  onChange={(event) => {
                    const groups = editing.groups.map((item, i) =>
                      i === index ? { ...item, id: event.target.value } : item,
                    );
                    setEditing({ ...editing, groups });
                  }}
                />
                <input
                  className="rounded-md border border-input bg-input px-2 py-1 text-ui-sm"
                  placeholder="分组名"
                  value={group.name}
                  onChange={(event) => {
                    const groups = editing.groups.map((item, i) =>
                      i === index ? { ...item, name: event.target.value } : item,
                    );
                    setEditing({ ...editing, groups });
                  }}
                />
                <input
                  className="rounded-md border border-input bg-input px-2 py-1 text-ui-sm"
                  placeholder="倍率（默认 1）"
                  value={group.groupRatio}
                  onChange={(event) => {
                    const groups = editing.groups.map((item, i) =>
                      i === index ? { ...item, groupRatio: event.target.value } : item,
                    );
                    setEditing({ ...editing, groups });
                  }}
                />
                <select
                  className="rounded-md border border-input bg-input px-2 py-1 text-ui-sm"
                  value={group.keyMode}
                  onChange={(event) => {
                    const groups = editing.groups.map((item, i) =>
                      i === index
                        ? { ...item, keyMode: event.target.value as GroupDraft["keyMode"] }
                        : item,
                    );
                    setEditing({ ...editing, groups });
                  }}
                >
                  <option value="single">单密钥</option>
                  <option value="random">随机</option>
                  <option value="polling">轮询</option>
                </select>
                <select
                  className="rounded-md border border-input bg-input px-2 py-1 text-ui-sm"
                  value={group.responseProtocol}
                  onChange={(event) => {
                    const groups = editing.groups.map((item, i) =>
                      i === index
                        ? {
                            ...item,
                            responseProtocol: event.target.value as GroupDraft["responseProtocol"],
                          }
                        : item,
                    );
                    setEditing({ ...editing, groups });
                  }}
                >
                  <option value="openai">OpenAI</option>
                  <option value="openai-response">OpenAI Responses</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="gemini">Gemini</option>
                </select>
                <textarea
                  className="col-span-3 rounded-md border border-input bg-input px-2 py-1 text-ui-sm"
                  rows={2}
                  placeholder="模型列表，每行一个"
                  value={group.modelsText}
                  onChange={(event) => {
                    const groups = editing.groups.map((item, i) =>
                      i === index ? { ...item, modelsText: event.target.value } : item,
                    );
                    setEditing({ ...editing, groups });
                  }}
                />
              </div>
            ))}
            <Button
              size="xs"
              variant="ghost"
              onClick={() =>
                setEditing({
                  ...editing,
                  groups: [
                    ...editing.groups,
                    {
                      id: "",
                      name: "",
                      baseUrl: "",
                      groupRatio: "1",
                      keyMode: "single",
                      responseProtocol: "openai",
                      modelsText: "",
                    },
                  ],
                })
              }
            >
              添加分组
            </Button>
          </div>
          <div className="mt-3 flex gap-2">
            <Button size="sm" disabled={saving} onClick={() => void handleSave()}>
              {saving ? "保存中…" : "保存"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
              取消
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
