# P2 Spec：Composer 增强（Danger 确认 / 省钱压缩 / /relay / 附件）

> 来源：移植 ultra composer 差异化点。附件经核查已对齐（图片/PDF/视频/文本+文件 mention），本 Phase 不动附件。

## 1. Danger 确认（yolo 选择门）

- ZCode 模式只有 build/edit/plan/yolo，不新增 runtime mode。Danger Bypass 语义 = yolo + 显式确认。
- 拦截点：`V4ComposerModeControls` radio 选中 `yolo` 时，若本 task 未确认 → 弹确认框（destructive；文案含 workspace 路径；checkbox「我已知晓风险」必填）→ 确认后执行 `onSwitchMode("yolo")` 并记住本 task（renderer-local `Set<taskKey>`，key = `sessionId ?? __draft__`）。
- 取消/关闭不切换模式，不写任何状态。

## 2. 省钱压缩 `$`（发送前 barrier）

- per-task 偏好 `{ enabled, threshold(50-95,默认80) }`，存 `taskFreeCompactByTaskId`（与 relay 选择同模式），切换任务独立。
- 工具条 `$` 按钮：显示阈值状态；popover 含启用开关 + 阈值滑杆 + 立即压缩按钮（走现有 `onSendCompressionCommand("/compact")`）。
- barrier（`SessionPane.handleSendText` 顶部，发送 admission 冻结之前）：
  仅当 `enabled && usagePercent >= threshold && 无运行中 turn && 距上次压缩 ≥60s && sessionId != null` → dispatch `/compact` → 返回 `"blocked"`（本次不发送，草稿保留，用户压缩后重发）。
- usagePercent = `usage.contextWindow.usedTokens / maxTokens`；无 usage 数据不触发。

## 3. `/relay` 本地命令

- `AppSlashCommand { value: "relay", keywords 中英, run: setPendingSettingsSectionIntent("relayChannels") + openSettingsTab() }`，挂 SessionPane 现有 appSlashCommands（CLI catalog 有同名时让路，沿用 filter 逻辑）。

## 4. 验收

- D1：选 yolo → 确认框 → 取消不切换；确认后切换；切任务后重新确认。
- D2：阈值 80、usage 85%、自动开 → 发送被拦下并跑 compact，草稿保留；60s 内再发送不重复触发；关闭开关后直发。
- D3：`/` 输入 relay → 打开设置中转渠道页。
- D4：`typecheck/lint/fmt` 全绿。
