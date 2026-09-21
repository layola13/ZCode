# P4 Spec：Kilo 免费渠道（免登录进入）

> 来源：移植 ultra `omniRouteFree.ts` 的 kilocode 分组（`https://api.kilo.ai/api/openrouter`，
> `authType: "none"`，无 key，`User-Agent: opencode-kilo-provider`，模型发现过滤
> `isFree || :free/-free` 后缀）。
> 目标：无任何登录（OAuth/API key）时，启动门禁 `hasUsableProvider` 为真，
> WelcomeScreen 不弹出，用户直接进入并可使用 Kilo 免费模型。

## 1. 模型与状态所有者

- `channel.free?: boolean`（schema 可选，默认 false）。free 渠道 = 不需要密钥：
  completeness 不要求 `access.apiKey`；`resolveRelayTarget` 返回空 key（执行层本就支持无
  Authorization 头）；`fetchChannelModels` 无 key 时不带 Authorization 头。
- Kilo 渠道以 **personal provider** (`id: "kilo-free"`, 名 "Kilo 免费") 存在，
  所有者为 relay 服务（`ensureKiloFreeChannel`），不是 builtin（不碰上游内置配置语义）。
  `api: { type: "openai-chat-completions", baseUrl: KILO, headers: { User-Agent } }`，
  `access: { type: "api-key" }`（空 key），`channel: { free: true, groups: [{ id: "kilocode" }] }`，
  模型写入 `personalModelIds`（走 configService，不直接写文件）。

## 2. 启动时序

```
services 装配 → providerRuntime 就绪 → ensureKiloFreeChannel()（后台，不阻断装配）
  ├─ 缺失/无 channel → 建骨架 + 同步写 fallback 模型（首启门禁只评估一次，必须同步有模型）
  ├─ 已有 channel → 不覆盖用户改动
  └─ 后台拉取实时模型（10s 上限）：成功则替换 personalModelIds；失败只 warn
      （离线退化：fallback 模型仍在，仍可免登录进入；执行时失败再看得到）
```

- 拉取失败永不抛；listChannels 不做隐式刷新（读不写，避免惊喜写入）。
- 登录门禁零改动：`hasUsableProvider = providers.some(models.length > 0)` 已覆盖。

## 3. 接口

- `IRelayChannelService.ensureKiloFreeChannel(): Promise<RelayChannelView | null>`（幂等）。
- `eligibleKiloFreeModels(payload: unknown): string[]`（纯函数，可单测）。
- UI：`groupRatio === 0` 显示"免费"（chips + 设置列表），不显示 `×0`。

## 4. 验收

- E1：干净 profile 启动（无 personal 文件）→ `GET /api/relays` 出现 kilo-free 且 models 非空 → WelcomeScreen 门禁条件满足。
- E2：`resolveRelayTarget({providerId: "kilo-free"})` 返回空 key + kilo baseUrl；fetch 不带 Authorization 头（单测断言）。
- E3：离线（fetch 失败）→ 启动不崩，渠道存在但无模型，登录墙行为与今日一致。
- E4：用户删除 kilo-free 后重启 → 重新补种（幂等）；用户改过 baseUrl → 不覆盖（只补模型）。
- E5：`typecheck/lint/fmt/arch` 全绿；新增单测通过。
- E6：公服重启后公网验证 relays 目录与免登录首屏语义。

## 5. 非目标

- CLI TUI 的首次登录流程不动；SEA/打包不动；不做定时刷新（只在装配与缺模型时拉取）。
