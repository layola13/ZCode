import assert from "node:assert/strict";
import test from "node:test";
import {
  inferRelayProtocol,
  normalizeRelayName,
  relayNameConflict,
} from "../src/config/relay-name.js";

test("normalizeRelayName：去尾缀/归一化（移植 ultra 语义）", () => {
  assert.equal(normalizeRelayName("吉吉中转站"), normalizeRelayName("吉吉 relay"));
  assert.equal(normalizeRelayName("DeepSeek-Channel"), "deepseek");
  assert.equal(normalizeRelayName("  open_ai中转 "), "openai");
});

test("relayNameConflict：归一化重名即冲突，排除自身", () => {
  const channels = [
    { providerId: "p1", providerName: "吉吉中转" },
    { providerId: "p2", providerName: "DeepKey" },
  ] as const;
  assert.equal(relayNameConflict("吉吉中转站", channels), "吉吉中转");
  assert.equal(relayNameConflict("吉吉 relay", channels), "吉吉中转");
  assert.equal(relayNameConflict("吉吉中转站", channels, "p1"), null);
  assert.equal(relayNameConflict("全新名字", channels), null);
});

test("relayNameConflict：内置保留名冲突", () => {
  assert.ok(relayNameConflict("openai 中转站", []) !== null);
  assert.equal(relayNameConflict("自建渠道", []), null);
});

test("inferRelayProtocol：按 baseUrl 推断，仅默认值", () => {
  assert.equal(inferRelayProtocol("https://api.anthropic.com/v1"), "anthropic");
  assert.equal(inferRelayProtocol("https://generativelanguage.googleapis.com/v1beta"), "gemini");
  assert.equal(inferRelayProtocol("https://relay.example/v1/responses"), "openai-response");
  assert.equal(inferRelayProtocol("https://api.deepseek.com/v1"), "openai");
  assert.equal(inferRelayProtocol(""), "openai");
});
