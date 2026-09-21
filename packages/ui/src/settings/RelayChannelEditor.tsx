import { Button } from "@/components/ui/button.js";
import { relayNameConflict } from "@zcode/provider";
import type { RelayChannelView } from "@zcode/services";
import type { ChannelDraft, GroupDraft } from "./relayChannelDraft.js";

interface Props {
  readonly draft: ChannelDraft;
  readonly channels: readonly RelayChannelView[];
  readonly saving: boolean;
  readonly onChange: (draft: ChannelDraft) => void;
  readonly onSave: () => void;
  readonly onCancel: () => void;
}

/** 渠道编辑表单：多 Key/分组管理/默认分组/回填不丢字段。 */
export function RelayChannelEditor({ draft, channels, saving, onChange, onSave, onCancel }: Props) {
  const conflict = relayNameConflict(draft.providerName, channels, draft.providerId);
  const set = (patch: Partial<ChannelDraft>) => onChange({ ...draft, ...patch });

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-ui-sm">
          名称
          <input
            className="rounded-md border border-input bg-input px-2 py-1 text-ui-sm"
            value={draft.providerName}
            onChange={(event) => set({ providerName: event.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-ui-sm">
          Base URL
          <input
            className="rounded-md border border-input bg-input px-2 py-1 text-ui-sm"
            value={draft.baseUrl}
            placeholder="https://relay.example/v1"
            onChange={(event) => set({ baseUrl: event.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-ui-sm">
          状态
          <select
            className="rounded-md border border-input bg-input px-2 py-1 text-ui-sm"
            value={draft.status}
            onChange={(event) =>
              set({ status: event.target.value as ChannelDraft["status"] })
            }
          >
            <option value="enabled">启用</option>
            <option value="disabled">禁用</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-ui-sm">
          默认分组 id（可选）
          <input
            className="rounded-md border border-input bg-input px-2 py-1 text-ui-sm"
            value={draft.defaultGroupId}
            placeholder="如 default"
            onChange={(event) => set({ defaultGroupId: event.target.value })}
          />
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-ui-sm">
          密钥（每行一个，最多 16；留空保留旧密钥）
          <textarea
            className="rounded-md border border-input bg-input px-2 py-1 text-ui-sm"
            rows={2}
            value={draft.apiKeysText}
            onChange={(event) => set({ apiKeysText: event.target.value })}
          />
        </label>
      </div>
      {draft.providerName.trim() && conflict ? (
        <p className="mt-1 text-ui-xs text-destructive">
          名称与现有渠道“{conflict}”冲突（归一化后重名）
        </p>
      ) : null}
      <div className="mt-2 flex flex-col gap-2">
        {draft.groups.map((group, index) => (
          <div key={index} className="grid grid-cols-3 gap-2 rounded-md bg-surface p-2">
            <input
              className="rounded-md border border-input bg-input px-2 py-1 text-ui-sm"
              placeholder="分组 id"
              value={group.id}
              onChange={(event) => {
                const groups = draft.groups.map((item, i) =>
                  i === index ? { ...item, id: event.target.value } : item,
                );
                set({ groups });
              }}
            />
            <input
              className="rounded-md border border-input bg-input px-2 py-1 text-ui-sm"
              placeholder="分组名"
              value={group.name}
              onChange={(event) => {
                const groups = draft.groups.map((item, i) =>
                  i === index ? { ...item, name: event.target.value } : item,
                );
                set({ groups });
              }}
            />
            <input
              className="rounded-md border border-input bg-input px-2 py-1 text-ui-sm"
              placeholder="倍率（0=免费，默认 1）"
              value={group.groupRatio}
              onChange={(event) => {
                const groups = draft.groups.map((item, i) =>
                  i === index ? { ...item, groupRatio: event.target.value } : item,
                );
                set({ groups });
              }}
            />
            <input
              className="rounded-md border border-input bg-input px-2 py-1 text-ui-sm"
              placeholder="分组 Base URL（可选，覆盖渠道）"
              value={group.baseUrl}
              onChange={(event) => {
                const groups = draft.groups.map((item, i) =>
                  i === index ? { ...item, baseUrl: event.target.value } : item,
                );
                set({ groups });
              }}
            />
            <select
              className="rounded-md border border-input bg-input px-2 py-1 text-ui-sm"
              value={group.status}
              onChange={(event) => {
                const groups = draft.groups.map((item, i) =>
                  i === index
                    ? { ...item, status: event.target.value as GroupDraft["status"] }
                    : item,
                );
                set({ groups });
              }}
            >
              <option value="enabled">分组启用</option>
              <option value="disabled">分组禁用</option>
            </select>
            <select
              className="rounded-md border border-input bg-input px-2 py-1 text-ui-sm"
              value={group.keyMode}
              onChange={(event) => {
                const groups = draft.groups.map((item, i) =>
                  i === index
                    ? { ...item, keyMode: event.target.value as GroupDraft["keyMode"] }
                    : item,
                );
                set({ groups });
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
                const groups = draft.groups.map((item, i) =>
                  i === index
                    ? {
                        ...item,
                        responseProtocol: event.target.value as GroupDraft["responseProtocol"],
                      }
                    : item,
                );
                set({ groups });
              }}
            >
              <option value="openai">OpenAI</option>
              <option value="openai-response">OpenAI Responses</option>
              <option value="anthropic">Anthropic</option>
              <option value="gemini">Gemini</option>
            </select>
            <textarea
              className="col-span-2 rounded-md border border-input bg-input px-2 py-1 text-ui-sm"
              rows={2}
              placeholder="模型列表，每行一个"
              value={group.modelsText}
              onChange={(event) => {
                const groups = draft.groups.map((item, i) =>
                  i === index ? { ...item, modelsText: event.target.value } : item,
                );
                set({ groups });
              }}
            />
            <Button
              size="xs"
              variant="ghost"
              onClick={() => set({ groups: draft.groups.filter((_, i) => i !== index) })}
            >
              删除分组
            </Button>
          </div>
        ))}
        <Button
          size="xs"
          variant="ghost"
          onClick={() =>
            set({
              groups: [
                ...draft.groups,
                {
                  id: "",
                  name: "",
                  baseUrl: "",
                  status: "enabled",
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
        <Button size="sm" disabled={saving} onClick={onSave}>
          {saving ? "保存中…" : "保存"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          取消
        </Button>
      </div>
    </div>
  );
}
