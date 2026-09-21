import { useState } from "react";
import { Button } from "@/components/ui/button.js";
import { inferRelayProtocol, relayNameConflict } from "@zcode/provider";
import type { RelayChannelView } from "@zcode/services";
import { RELAY_VENDOR_DIRECTORY } from "./relayVendorDirectory.js";
import type { GroupDraft } from "./relayChannelDraft.js";

interface Props {
  readonly channels: readonly RelayChannelView[];
  readonly saving: boolean;
  readonly onCreate: (input: {
    providerName: string;
    baseUrl: string;
    apiKey: string;
    protocol: GroupDraft["responseProtocol"];
    modelsText: string;
  }) => void;
}

/** 快速新建（移植 ultra 快速建站：厂商目录 + 协议推断 + 重名校验）。 */
export function RelayQuickCreate({ channels, saving, onCreate }: Props) {
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState(RELAY_VENDOR_DIRECTORY[0]?.baseUrl ?? "");
  const [apiKey, setApiKey] = useState("");
  const [protocol, setProtocol] = useState<GroupDraft["responseProtocol"]>(
    RELAY_VENDOR_DIRECTORY[0]?.protocol ?? "openai",
  );
  const [modelsText, setModelsText] = useState("");
  const conflict = name.trim() ? relayNameConflict(name, channels) : null;

  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-ui-sm font-medium">快速新建</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-ui-sm">
          厂商（仅填充默认值）
          <select
            className="rounded-md border border-input bg-input px-2 py-1 text-ui-sm"
            value={baseUrl}
            onChange={(event) => {
              const vendor = RELAY_VENDOR_DIRECTORY.find(
                (item) => item.baseUrl === event.target.value,
              );
              setBaseUrl(event.target.value);
              setProtocol(
                vendor ? vendor.protocol : inferRelayProtocol(event.target.value),
              );
            }}
          >
            {RELAY_VENDOR_DIRECTORY.map((vendor) => (
              <option key={vendor.id} value={vendor.baseUrl}>
                {vendor.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-ui-sm">
          协议（按 Base URL 推断，可改）
          <select
            className="rounded-md border border-input bg-input px-2 py-1 text-ui-sm"
            value={protocol}
            onChange={(event) =>
              setProtocol(event.target.value as GroupDraft["responseProtocol"])
            }
          >
            <option value="openai">OpenAI</option>
            <option value="openai-response">OpenAI Responses</option>
            <option value="anthropic">Anthropic</option>
            <option value="gemini">Gemini</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-ui-sm">
          名称
          <input
            className="rounded-md border border-input bg-input px-2 py-1 text-ui-sm"
            value={name}
            placeholder="如 吉吉中转"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-ui-sm">
          Base URL
          <input
            className="rounded-md border border-input bg-input px-2 py-1 text-ui-sm"
            value={baseUrl}
            placeholder="https://relay.example/v1"
            onChange={(event) => {
              setBaseUrl(event.target.value);
              setProtocol(inferRelayProtocol(event.target.value));
            }}
          />
        </label>
        <label className="flex flex-col gap-1 text-ui-sm">
          密钥
          <input
            type="password"
            className="rounded-md border border-input bg-input px-2 py-1 text-ui-sm"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-ui-sm">
          模型（可选，每行一个）
          <input
            className="rounded-md border border-input bg-input px-2 py-1 text-ui-sm"
            value={modelsText}
            onChange={(event) => setModelsText(event.target.value)}
          />
        </label>
      </div>
      {conflict ? (
        <p className="mt-1 text-ui-xs text-destructive">
          名称与现有渠道“{conflict}”冲突（归一化后重名）
        </p>
      ) : null}
      <div className="mt-2 flex gap-2">
        <Button
          size="xs"
          disabled={saving}
          onClick={() => {
            onCreate({ providerName: name, baseUrl, apiKey, protocol, modelsText });
            setName("");
            setApiKey("");
            setModelsText("");
          }}
        >
          {saving ? "保存中…" : "快速创建"}
        </Button>
      </div>
    </div>
  );
}
