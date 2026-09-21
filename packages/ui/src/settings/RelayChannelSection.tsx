import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button.js";
import { useRelayChannels } from "@/hooks/useRelayChannels.js";
import { relayNameConflict } from "@zcode/provider";
import { RelayChannelEditor } from "./RelayChannelEditor.js";
import { RelayQuickCreate } from "./RelayQuickCreate.js";
import {
  parseKeys,
  parseModels,
  toChannelDraft,
  type ChannelDraft,
} from "./relayChannelDraft.js";

export function RelayChannelSection() {
  const { available, loading, error, channels, saveChannel, deleteChannel, fetchModels } =
    useRelayChannels();
  const [editing, setEditing] = useState<ChannelDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fetching, setFetching] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
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
      const name = editing.providerName.trim();
      if (!name) throw new Error("名称不能为空");
      const conflict = relayNameConflict(name, channels, editing.providerId);
      if (conflict) throw new Error(`名称与现有渠道“${conflict}”冲突（归一化后重名）`);
      const ratio = (text: string) => {
        const value = Number(text);
        return Number.isFinite(value) && value >= 0 ? value : 1;
      };
      const keys = parseKeys(editing.apiKeysText);
      if (keys.length > 16) throw new Error("密钥最多 16 个，每行一个");
      await saveChannel({
        ...(editing.providerId ? { providerId: editing.providerId } : {}),
        providerName: name,
        baseUrl: editing.baseUrl.trim() || null,
        status: editing.status,
        ...(keys.length > 0 ? { apiKeys: keys } : {}),
        defaultGroupId: editing.defaultGroupId.trim() || null,
        groups: editing.groups
          .filter((group) => group.id.trim())
          .map((group) => ({
            id: group.id.trim(),
            name: group.name.trim() || group.id.trim(),
            baseUrl: group.baseUrl.trim() || null,
            status: group.status,
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

  async function handleTest(providerId: string, groupId: string) {
    setTesting(`${providerId}:${groupId}`);
    setTestResult(null);
    setFormError(null);
    try {
      const models = await fetchModels(providerId, groupId, { save: false });
      setTestResult(`连接正常，发现 ${models.length} 个模型`);
    } catch (error: unknown) {
      setFormError(error instanceof Error ? error.message : String(error));
    } finally {
      setTesting(null);
    }
  }

  async function handleQuickCreate(input: {
    providerName: string;
    baseUrl: string;
    apiKey: string;
    protocol: ChannelDraft["groups"][number]["responseProtocol"];
    modelsText: string;
  }) {
    setSaving(true);
    setFormError(null);
    try {
      const name = input.providerName.trim();
      if (!name) throw new Error("快速新建：名称不能为空");
      const conflict = relayNameConflict(name, channels);
      if (conflict) throw new Error(`名称与现有渠道“${conflict}”冲突（归一化后重名）`);
      if (!input.baseUrl.trim()) throw new Error("快速新建：Base URL 不能为空");
      if (!input.apiKey.trim()) throw new Error("快速新建：密钥不能为空");
      await saveChannel({
        providerName: name,
        baseUrl: input.baseUrl.trim(),
        status: "enabled",
        apiKeys: [input.apiKey.trim()],
        groups: [
          {
            id: "default",
            name: "default",
            groupRatio: 1,
            keyMode: "single",
            models: parseModels(input.modelsText),
            responseProtocol: input.protocol,
          },
        ],
      });
    } catch (error: unknown) {
      setFormError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-ui-sm text-foreground-subtle">
          第三方中转渠道（baseUrl + 密钥 + 分组 + 倍率）。密钥只写不读，留空即保留。×0
          表示免费。
        </p>
        <Button
          size="sm"
          onClick={() => {
            setEditing(toChannelDraft());
            setFormError(null);
          }}
        >
          新建渠道
        </Button>
      </div>
      {error ? <p className="text-ui-sm text-destructive">{error}</p> : null}
      {formError ? <p className="text-ui-sm text-destructive">{formError}</p> : null}
      {testResult ? <p className="text-ui-sm text-foreground-subtle">{testResult}</p> : null}
      <RelayQuickCreate channels={channels} saving={saving} onCreate={handleQuickCreate} />
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
                  setEditing(toChannelDraft(channel));
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
                  {group.groupName} · {group.groupRatio === 0 ? "免费" : `×${group.groupRatio}`} ·{" "}
                  {group.models.length} 个模型 · {group.responseProtocol ?? "openai"}/
                  {group.keyMode ?? "single"}
                  {group.status !== "enabled" ? " · 已禁用" : ""}
                  {channel.defaultGroupId === group.groupId ? " · 默认" : ""}
                </span>
                <span className="flex gap-2">
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={fetching === `${channel.providerId}:${group.groupId}`}
                    onClick={() => void handleFetch(channel.providerId, group.groupId)}
                  >
                    {fetching === `${channel.providerId}:${group.groupId}` ? "同步中…" : "同步模型"}
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={testing === `${channel.providerId}:${group.groupId}`}
                    onClick={() => void handleTest(channel.providerId, group.groupId)}
                  >
                    {testing === `${channel.providerId}:${group.groupId}` ? "测试中…" : "测试连接"}
                  </Button>
                </span>
              </div>
            ))}
            {channel.groups.length === 0 ? (
              <span className="text-ui-sm text-foreground-subtle">暂无分组，先编辑添加。</span>
            ) : null}
          </div>
        </div>
      ))}
      {editing ? (
        <RelayChannelEditor
          draft={editing}
          channels={channels}
          saving={saving}
          onChange={setEditing}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
