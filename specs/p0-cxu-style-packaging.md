# P0 Spec：cxu 式打包（launcher + server-bundle + 产物卫生）

> 来源：移植 ultra（codex-react-ui）`packages/cxu` + `scripts/launch.mjs` 链路。
> 原则：加法变更，不动 `build:zcode` tarball 通道与现有 `entry-http` 行为。

## 1. 背景与差距

- ZCode 现状：`scripts/build-zcode.mjs` 组装多文件 `server/dist`（15M，含 chunks/.d.ts/.map）+ `web/dist` + `agent/zcode.cjs` + vendored node_modules → tarball → `install.sh` 拉 `latest.json` → `~/.local/bin/zcode` shim `exec node …/current/bin/zcode.mjs`。运行强依赖系统 node，无 doctor、无版本化缓存、无单文件 server。
- cxu 形态（对标）：npm 包 `files=[dist,wasm,web-dist,server-bundle]` + `bin.cxu` + 首次运行编译/校验 + `doctor` + `~/.cxu/server/v<ver>/` 缓存 + env 驱动（`CODEX_UI_WEB_DIST/PORT/DATA_DIR`）。
- 好消息：`packages/server/src/entry-http.ts` 已是 env 驱动（`PORT/HOST/ZCODE_SERVER_HOST/ZCODE_WEB_STATIC_ROOT/ZCODE_SERVER_AUTH_TOKEN`），launcher 只需 spawn + 传 env，不用改 server。

## 2. 范围（本 Phase 做什么 / 不做什么）

做：

- 2.1 `scripts/build-server-bundle.mjs`：esbuild 单文件 `dist/server-bundle/index.js`（ESM，`platform:node,target:node22`，`define` 复用版本/环境/builtin 配置，`external` 与 `packages/server/tsup.config.ts` 的 `SERVER_HTTP_EXTERNAL_DEPENDENCIES` 保持一致并注释互指）。
- 2.2 产物卫生：构建后断言 bundle 目录无 `*.map` / `sourceMappingURL`（ultra `verify-production-artifacts.mjs` 的最小子集）；接到 `build:zcode` 之后执行。
- 2.3 `@zcode/launcher` 新包：`bin.zcode-serve`（暂名，定名时确认），职责：`doctor`（node>=24、端口可用、agent `zcode.cjs` 存在、web-dist index.html 存在）→ 解析三件套路径（`ZCODE_WEB_DIST` / 包内 `web-dist` / `--web-dist` 显隐优先级，**必须打印实际生效路径**，防 ultra 踩过的 stale preview 坑：同时校验 served `index.html` 的构建指纹与本地一致）→ spawn `node server-bundle` 传 env → 打印访问地址。
- 2.3 `@zcode/launcher` 新包（已调整为两步走，见“实现记录”）：`bin.zcode-serve`（暂名，定名时确认），职责：`doctor`（node>=24、端口可用、agent `zcode.cjs` 存在、web-dist index.html 存在）→ 解析三件套路径（`ZCODE_WEB_DIST` / 包内 `web-dist` / `--web-dist` 显隐优先级，**必须打印实际生效路径**，防 ultra 踩过的 stale preview 坑：同时校验 served `index.html` 的构建指纹与本地一致）→ spawn `node server-bundle` 传 env → 打印访问地址。
- 2.4 安装器升级：`installer.mjs` 增加版本化缓存 `~/.zcode/launcher/v<ver>/`（命中复用，未命中拷贝），`~/.local/bin` shim 指向 launcher；tarball 通道保留为 fallback。

## 6. 实现记录（2026-09-21）

- P0.1 + 产物卫生已落地：`scripts/build-server-bundle.mjs`（单文件 ESM 4.35MB，`--verify-only` 独立校验），A1/A2 已验证（bundle 启动后 `/api/server-info` 与 web 200 正常）。
- external 表在 tsup 基础上追加 `ws`（CJS 内联进 ESM 会 `Dynamic require of "events"` 启动崩，实测确认）。
- P0.2 先落为根脚本 `scripts/zcode-serve.mjs`（未新建 workspace 包，理由：`@zcode/server-cli` 已有 server 进程管理，另起包会造成职责重叠；包化待 server-cli 职责切分后再议）。`--doctor-only` 与全链启动已验证；agent env 写法与 `scripts/zcode-distribution/runner.mjs` 对齐（COMMAND=node 本体）。
- web 无构建指纹 meta，指纹校验用本地 vs served 的 `assets/index-*.js` 引用比对实现。
- `package.json` 新增 `build:server-bundle` / `serve` 入口；`build:zcode` 未动（bundle 脚本自带卫生校验，避免碰发行路径）。
- 待做：SEA 单文件（二期）。
- 实现记录（2026-09-21，P0 收尾）：`build-zcode.mjs` 组装 server-bundle（`buildOutputs` 构建 + `stageZCodePackage` 拷入 `server-bundle/`）；`installer.mjs` 生成脚本加版本化缓存命中（`releases/$VERSION/server-bundle/index.js` 存在且无 `ZCODE_DIST_FORCE=1` 即跳过下载解压）。

不做（二期）：SEA 单文件可执行（复用现有 `build-sea.mjs/postject` 链，另起 spec）；桌面 Electron 集成；自更新通道。

## 3. 状态所有者与接口

- 三件套路径解析唯一所有者：launcher（`resolveBundlePaths()`），server 只认 env，不猜路径。
- 版本唯一来源：根 `package.json`（与 `tsup.config.ts` 同源）。
- 接口：
  - `build-server-bundle.mjs [--out <dir>] [--verify-only]`，输出 `dist/server-bundle/index.js + .build-info.json{version,builtAt,entry,external[]}`。
  - `zcode-serve [--port <n>] [--host <addr>] [--web-dist <dir>] [--data-dir <dir>] [--doctor-only] [--no-open]`。
  - env：`PORT/ZCODE_SERVER_HOST/ZCODE_WEB_STATIC_ROOT/ZCODE_SERVER_AUTH_TOKEN/ZCODE_DATA_BASE_DIR`（沿用 entry-http 现有语义，不新增）。

## 4. 验收场景

- A1：`node scripts/build-server-bundle.mjs` 在干净检出（刚 `pnpm install`）一次成功，产物单文件可 `node dist/server-bundle/index.js` 启动，`GET /api/server-info` 200。
- A2：bundle 目录无 `*.map`、无 `sourceMappingURL`（脚本非零退出否则）。
- A3：`ZCODE_WEB_DIST` 指向过期目录时，launcher 报错并打印期望指纹 vs 实际指纹，不静默服务旧 UI。
- A4：`zcode-serve --doctor-only` 在缺 node / 端口被占 / 缺 web-dist 时分别给出可操作提示，退出码非零。
- A5：`pnpm typecheck + pnpm lint + pnpm architecture:check` 全绿；`build:zcode` tarball 通道行为不变。

## 5. 风险与回滚

- esbuild 单文件 vs tsup 多文件：CJS 依赖的动态 require 坑（tsup 注释已列 `node-forge/yazl/yauzl/undici/axios` 外置原因），bundle 脚本必须逐条继承 external 表，A1 即覆盖。
- 回滚：新增文件独立，删除 `scripts/build-server-bundle.mjs` + `packages/zcode-launcher` 即回滚，不动存量。
