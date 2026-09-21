# P1 Spec：中转渠道（Relay Channels）

> 来源：移植 ultra `ProviderConfig/ChannelGroupConfig + providerStore + relay-settings 路由 + threadRuntimeMetadata`。
> 策略：只移植数据模型/密钥语义/只读目录/per-thread 选择；不移植 4114 行协议网关（ZCode 自有执行路径）。

## 1. 领域模型

- 中转渠道 = `group: "standard-personal"` 的 personal provider + 可选 `channel` 对象（普通 personal provider 无 `channel`，行为零变化）。
- `channel`：`{ name?, baseUrl?, status: enabled|disabled, groups: ChannelGroup[], defaultGroupId?, trashedAt? }`。
- `ChannelGroup`：`{ id, name, baseUrl?, status, groupRatio(≥0,默认1；0=免费）, keyMode: single|random|polling(默认single), models: string[], responseProtocol: openai-response|openai|anthropic|gemini(默认openai), contextWindow? }`。密钥不进 config 文件。
- 密钥：`credentialService` key `relay-channel:<providerId>` 存 JSON string[]；读接口只暴露 `apiKeyConfigured + apiKeyPreview(••••后4)`；**更新不传 key = 保留旧 key**。
- per-thread 选择：`{ providerId, groupId?, model? }`，所有者为 relay 服务（`thread-relay-selection.json`，`withFileLock`，threadId 主键）；UI 只做缓存，服务端权威。

## 2. 接口

- RPC 服务 `IRelayChannelService`（channelName `relayChannel`，自动经 ChannelServer 暴露）：
  - `listChannels(): RelayChannelView[]`（脱敏：无明文 key）
  - `saveChannel(input: SaveRelayChannelInput): RelayChannelView`（input 含可选 `apiKeys?: string[]`；未传则保留；`models/fetch` 不在这里）
  - `deleteChannel(providerId): void`（删 personal provider + 删密钥）
  - `fetchChannelModels(providerId, groupId, selectedModels?): string[]`（`GET {base}/models` 12s 超时；`selectedModels` 非空时必须是返回子集否则 400；`save!==false` 才回写 `personalModelIds`——回写经 configService，不直接写文件）
  - `resolveRelayTarget(input): { baseUrl, apiKey, protocol }`（polling 按 cursor 轮换，single 取首个；无可用 key 时抛错，不 fallback）
  - `getThreadSelection(threadId) / setThreadSelection(threadId, selection)`（selection null = 清除）
- HTTP（`packages/server/src/relayRoutes.ts`，复用全局 token 中间件，不另加鉴权）：
  - `GET /api/relay-settings`、`POST /api/relay-settings`、`GET/PUT/DELETE /api/relay-settings/:id`
  - `GET /api/relays`、 `GET /api/relays/:id/groups`（脱敏目录）
  - `POST /api/relay-settings/:id/groups/:groupId/models/fetch`
  - `GET/PUT /api/thread-relay-selection?threadId=`

## 3. UI

- 设置页新增"中转渠道" Section：列表（名/状态/分组数/倍率/key 已配置）→ 新建/编辑（baseUrl、分组表、keyMode、key 输入框留空=保留、fetch 模型按钮）→ 删除（二次确认）。
- Composer 工具条新增渠道 chip（provider/group/model 三级，复用 `ModelConfigSelect` 控件语言）：选择写入会话 `relaySelection` + 服务端 thread selection；切换会话恢复各自选择。
- 状态：`zcodeSessionStore` 加 `relaySelection`（内存 + 草稿缓存），服务端权威以 thread selection 为准。

## 4. 验收

- B1：新建渠道（baseUrl+key+1 分组+2 模型）→ 列表显示已配置 → 重启保留 → 读接口无明文。
- B2：编辑不填 key → 旧 key 可用（resolve 返回旧 key）；填新 key → 轮换。
- B3：`keyMode: polling` + 2 keys → 连续 resolve 交替返回。
- B4：fetch 返回模型列表；`selectedModels` 含未返回模型 → 400。
- B5：会话 A 选渠道 X，会话 B 选内置 → 切换恢复各自选择；删除渠道后选过它的会话回退空选择不崩。
- B6：`pnpm typecheck + pnpm lint + architecture:check` 全绿；单测 `relayChannelService.test.ts` 通过。

## 5. 风险

- provider strict schema 新增可选字段：旧文件无此字段不受影响；`serializeRegistryProviderConfig` 透传 channel（registry 消费者忽略未知字段需验证——实际是白名单序列化，已显式处理）。
- channel provider 的 registry 准入：仍走 personal 完整校验（access+api 必填），fetch 前的未配 key 渠道进 registry 会失败并产出 issue，这是预期行为（B1 覆盖）。

## 6. P1.1：移植 ultra 设置体验（不移植协议网关）

> 来源：ultra `SettingsDrawer RelaySettingsPanel + advancedRelayDirectory + relayNameValidation`。
> 策略：只移植设置交互（建站流程/校验/展示），不移植 ultra 协议网关、网关重试/熔断/健康检查、费用统计、审计日志、分享/备份含钥、Claude/Cursor 注入、能力目录。

- 所有者：`IRelayChannelService` 仍是渠道/分组唯一事实源；`RelayChannelView` 为脱敏只读投影；编辑草稿为 UI 局部状态，保存经 `saveChannel`，模型发现经 `fetchChannelModels`。
- View 扩展（加法、可选）：`RelayChannelView.defaultGroupId?`，`RelayChannelGroupView.keyMode?/responseProtocol?/baseUrl?`，用于编辑回填不丢字段。旧消费者忽略新字段。
- 纯函数（`packages/provider/src/config/relay-name.ts`，无 IO）：
  - `normalizeRelayName`：`trim→lower→[\\s_-]+归一→去尾缀(中转站?|relay|channel)`，移植 ultra 语义。
  - `relayNameConflict(name, channels)`：与现有 `providerId/providerName` 归一化比对 + 内置保留名（`openai/deepseek/deepkey/linuxdo/gemini/anthropic/google`）。
  - `inferRelayProtocol(baseUrl)`：`anthropic→anthropic`、`gemini→gemini`、`responses?→openai-response`，默认 `openai`；仅做新建默认值，不改已存值。
- 厂商目录（`packages/ui/src/settings/relayVendorDirectory.ts`，纯数据）：OpenAI 兼容/DeepSeek/Anthropic/Gemini/自定义，含 `baseUrl + protocol` 默认；选择厂商仅填充新建表单默认值。
- 设置 UI（`RelayChannelSection`）：
  - 修 `toDraft` 丢字段：回填 `defaultGroupId`、分组 `baseUrl/keyMode/responseProtocol/status`，密钥仍留空=保留。
  - 多 Key：`textarea` 每行一个，最多 16；`polling/random` 才有意义，`single` 取首个；留空=保留旧密钥。
  - 分组管理：可删分组、可设 `defaultGroupId`、可填分组 `baseUrl`、可设分组 `status`；列表显示 `protocol/keyMode/baseUrl/分组status/默认分组`。
  - 快速新建：名称/baseUrl/密钥/协议 + 厂商选择 + `获取模型`（`save:false` 只读探测，不回写）+ 手工模型；重名冲突提示；`×0` 显示免费。
  - 测试连接：已存渠道用 `fetchChannelModels({save:false})` 做只读探测，成功/失败行内提示；不调用 `activate`，不改全局 provider。
- 验收：
  - C1：编辑渠道后保存，分组 `keyMode/protocol/baseUrl/defaultGroupId` 不被重置为默认值。
  - C2：重名（归一化后，如 `吉吉中转站` vs `吉吉 relay`）给出冲突提示。
  - C3：多 Key 保存后 `apiKeyConfigured` 为真，`polling` resolve 交替（已有 B3 覆盖服务层）。
  - C4：测试连接失败显示错误，不写 `personalModelIds`。
  - C5：`pnpm typecheck + pnpm lint + architecture:check` 全绿；新增 `relay-name.test.ts` 通过。
