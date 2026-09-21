# P3 Spec：自定义主题插件

> 来源：移植 ultra `ThemePlugin` 模型 + 管理器 UX（preview 三色、背景媒体、JSON 导入导出）。
> 策略：只移植插件模型与管理 UX；ultra 是 MUI `createTheme`，ZCode 是 CSS 变量 token——
> 渲染层用 ZCode token 重实现，不引 MUI/three.js。ZIP 暂不支持（无 jszip 依赖），只做 JSON。

## 1. 模型（`ZThemePlugin`）

`{ id, name, source: "user-defined", dark: boolean, preview: { primary, secondary, background } (hex), assets?: { appBackgroundImage?: dataURL|http(s) }, layout?: { workspaceSurfaceOpacity?: 0-1 } }`。
校验：id/name 非空，preview 三色必须为 `#rgb/#rrggbb`，image ≤6MiB（dataURL 按 base64 解码估算），未知字段拒绝（声明式渲染，不执行 JS）。

## 2. Token 映射（唯一渲染契约）

- `background` → `--color-background`、`--color-sidebar`、`--color-card`、`--color-popover`
- `primary` → `--color-brand`
- `secondary` → `--color-accent`
- 前景色由 `dark` 派生：dark → `#fff` 系（`--color-foreground` 等），light → `#111` 系；其余 token 全部回落基座（dark→zai-dark 类，light→zai-light 类）。
- 字阶/字号/圆角/间距一律不动（`DESIGN.md` 约束）。
- 实现：`documentElement.style.setProperty`（内联优先级高于 class）；停用时清除属性 + 摘 `theme-custom` 类。

## 3. 状态与持久化（本地优先，偏差记录）

- `localStorage`：`zcode-theme-custom-plugins`（数组，仅 `source=user-defined`）、`zcode-theme-custom-active`（id）。
- `Theme` 增加 `"custom"`；`resolveTheme(custom)` 读 active 插件 `dark`（无插件回落 dark）；`applyTheme(custom)` 走映射；`useTheme` 读写不变。
- ultra 有服务端偏好同步，ZCode 本 Phase 只做本地（设置同步服务无主题字段；后续接 `SettingsSync` 时再议）。

## 4. UI

- 外观设置新增"自定义主题"卡片：列表（preview 三色块 + 应用/删除）→ 编辑器（三色 input + 背景图上传≤6MiB + 明暗基座切换）→ 导出 JSON（下载）/导入 JSON（文件选择≤16MiB，非法拒绝并提示）。
- `CustomThemeBackground` 挂 `RootShell` 首子节点：image → CSS cover 固定层（`workspaceSurfaceOpacity` 控制不透明度），无图不渲染。
- `THEME_MODES` 加 custom（图标 Sun/Moon 复用，按 active 插件 dark 切换显示即可；首版固定用 Palette 图标）。

## 5. 验收

- C1：新建三色主题并应用 → 页面底色/品牌色变化，字阶不变；刷新后保持。
- C2：上传 7MiB 图片被拒；导入含 `script` 字段/坏色的 JSON 被拒并提示。
- C3：删除正在用的主题 → 自动回落 `zai-dark`，不白屏。
- C4：从 ultra 导出的主题 JSON（含 preview 三色）可导入并渲染（字段超集忽略）。
- C5：`typecheck/lint/fmt` 全绿。
