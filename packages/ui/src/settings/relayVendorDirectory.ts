import type { RelayChannelResponseProtocol } from "@zcode/provider";

export interface RelayVendorOption {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly protocol: RelayChannelResponseProtocol;
}

/**
 * 厂商目录（移植 ultra AdvancedRelayDirectory 思想，ZCode 自有精简版）：
 * 选择仅填充新建表单默认值，不决定执行路由。
 */
export const RELAY_VENDOR_DIRECTORY: readonly RelayVendorOption[] = [
  {
    id: "openai-compatible",
    name: "OpenAI 兼容",
    baseUrl: "https://api.openai.com/v1",
    protocol: "openai",
  },
  {
    id: "openai-response",
    name: "OpenAI Responses",
    baseUrl: "https://api.openai.com/v1",
    protocol: "openai-response",
  },
  { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", protocol: "openai" },
  {
    id: "anthropic",
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    protocol: "anthropic",
  },
  {
    id: "gemini",
    name: "Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    protocol: "gemini",
  },
  { id: "custom", name: "自定义", baseUrl: "", protocol: "openai" },
];
