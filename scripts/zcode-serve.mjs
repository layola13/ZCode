#!/usr/bin/env node
// cxu 式 launcher（dev/验证用）：doctor → 解析 server-bundle/web-dist/agent 三件套
// → spawn 单文件 server → 就绪探测 → served UI 指纹校验 → 打印/打开地址。
// server 本体行为不归这里管，只透传 env（见 packages/server/src/entry-http.ts）。
// npm 包化（@zcode/launcher）是后续步骤，本脚本先沉淀路径解析与校验逻辑。
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const usage = `Usage:
  node scripts/zcode-serve.mjs [--port 3030] [--host 127.0.0.1]
    [--server-bundle dist/server-bundle] [--web-dist packages/web/dist]
    [--workspace <dir>] [--data-dir <dir>] [--doctor-only] [--no-open]

Options:
  --port <n>          Port. Defaults to 3030.
  --host <addr>       Bind host. Defaults to 127.0.0.1.
  --server-bundle <d> Server bundle dir (index.js + .build-info.json).
  --web-dist <dir>    Web static root served by the server.
  --workspace <dir>   ZCODE_SERVER_WORKSPACE. Defaults to cwd.
  --data-dir <dir>    ZCODE_DATA_BASE_DIR passthrough.
  --doctor-only       Run checks and exit without starting.
  --no-open           Do not open the browser automatically.
  --help, -h          Show this help.
`;

function readArgValue(argv, arg, index) {
  if (arg.includes("=")) {
    return { nextIndex: index, value: arg.slice(arg.indexOf("=") + 1) };
  }
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${arg}`);
  }
  return { nextIndex: index + 1, value };
}

function parseArgs(argv) {
  const options = {
    port: 3030,
    host: "127.0.0.1",
    serverBundle: resolve(root, "dist/server-bundle"),
    webDist: resolve(root, "packages/web/dist"),
    workspace: process.cwd(),
    dataDir: undefined,
    doctorOnly: false,
    open: true,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--doctor-only") {
      options.doctorOnly = true;
      continue;
    }
    if (arg === "--no-open") {
      options.open = false;
      continue;
    }
    if (arg === "--port" || arg.startsWith("--port=")) {
      const { nextIndex, value } = readArgValue(argv, arg, index);
      options.port = Number(value);
      index = nextIndex;
      continue;
    }
    for (const [flag, key] of [
      ["--host", "host"],
      ["--server-bundle", "serverBundle"],
      ["--web-dist", "webDist"],
      ["--workspace", "workspace"],
      ["--data-dir", "dataDir"],
    ]) {
      if (arg === flag || arg.startsWith(`${flag}=`)) {
        const { nextIndex, value } = readArgValue(argv, arg, index);
        options[key] = key === "host" ? value : resolve(value);
        index = nextIndex;
        break;
      }
    }
  }
  return options;
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function isLoopback(host) {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

async function isPortFree(port, host) {
  return new Promise((resolveFree) => {
    const tester = createServer();
    tester.once("error", () => resolveFree(false));
    tester.listen(port, host === "localhost" ? "127.0.0.1" : host, () => {
      tester.close(() => resolveFree(true));
    });
  });
}

// doctor：缺什么说什么，不猜不修。
async function doctor(options) {
  const problems = [];
  const [major] = process.version.replace(/^v/, "").split(".").map(Number);
  if (major < 24) {
    problems.push(`node ${process.version} < 24 (see mise.toml)`);
  }
  const bundleEntry = resolve(options.serverBundle, "index.js");
  if (!(await pathExists(bundleEntry))) {
    problems.push(
      `missing server bundle: ${bundleEntry} (run node scripts/build-server-bundle.mjs)`,
    );
  }
  const webIndex = resolve(options.webDist, "index.html");
  if (!(await pathExists(webIndex))) {
    problems.push(`missing web dist: ${webIndex} (build @zcode/web first)`);
  }
  if (!(await isPortFree(options.port, options.host))) {
    problems.push(`port ${options.port} on ${options.host} is occupied`);
  }
  const agentEntry = resolve(root, "apps/zcode-cli/packages/cli/dist/zcode.cjs");
  const agent = (await pathExists(agentEntry)) ? agentEntry : undefined;
  return { problems, bundleEntry, webIndex, agent };
}

// 本地 index.html 的主 asset 引用即构建指纹（web 构建产物无 meta 指纹，不改构建）。
async function localAssetFingerprint(webIndex) {
  const html = await readFile(webIndex, "utf-8");
  const match = html.match(/assets\/index-[^"']+\.js/);
  return match ? match[0] : undefined;
}

async function servedAssetFingerprint(url) {
  const res = await fetch(url);
  if (!res.ok) return undefined;
  const html = await res.text();
  const match = html.match(/assets\/index-[^"']+\.js/);
  return match ? match[0] : undefined;
}

async function waitForReady(baseUrl, token, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`${baseUrl}/api/server-info?token=${token}`);
      if (res.ok) return true;
    } catch {
      // 未就绪继续轮询。
    }
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, 300));
  }
}

function openBrowser(url) {
  const opener =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  spawn(opener, [url], { stdio: "ignore", shell: process.platform === "win32" });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage);
    return;
  }
  const { problems, bundleEntry, webIndex, agent } = await doctor(options);
  console.log(`[zcode-serve] server-bundle: ${bundleEntry}`);
  console.log(`[zcode-serve] web-dist:      ${webIndex}`);
  console.log(
    `[zcode-serve] agent:         ${agent ?? "(not built, server starts without agent runtime)"}`,
  );
  if (problems.length > 0) {
    for (const problem of problems) console.error(`[zcode-serve] doctor: ${problem}`);
    process.exitCode = 1;
    return;
  }
  console.log("[zcode-serve] doctor: OK");
  if (options.doctorOnly) return;

  // 非回环监听默认生成访问令牌（与 zcode --web 语义一致）。
  const token =
    process.env["ZCODE_SERVER_AUTH_TOKEN"]?.trim() ||
    (isLoopback(options.host) ? "" : randomBytes(32).toString("hex"));
  const hostForUrl =
    options.host === "0.0.0.0" || options.host === "::" ? "127.0.0.1" : options.host;
  const baseUrl = `http://${hostForUrl}:${options.port}`;
  const launchUrl = token ? `${baseUrl}/?token=${token}` : `${baseUrl}/`;

  const env = {
    ...process.env,
    PORT: String(options.port),
    ZCODE_SERVER_HOST: options.host,
    ZCODE_WEB_STATIC_ROOT: options.webDist,
    ZCODE_SERVER_WORKSPACE: options.workspace,
    ...(token ? { ZCODE_SERVER_AUTH_TOKEN: token } : {}),
    ...(options.dataDir ? { ZCODE_DATA_BASE_DIR: options.dataDir } : {}),
    ...(agent
      ? {
          // 与发行 runner（scripts/zcode-distribution/runner.mjs）一致：
          // COMMAND 永远是 node 本体，cjs 入口走 args 首位。
          ZCODE_AGENT_SERVER_COMMAND: process.execPath,
          ZCODE_AGENT_SERVER_ARGS_JSON: JSON.stringify([agent, "app-server", "--stdio"]),
        }
      : {}),
  };
  const child = spawn(process.execPath, [bundleEntry], { env, stdio: "inherit" });
  const ready = await waitForReady(baseUrl, token);
  if (!ready) {
    console.error("[zcode-serve] server did not become ready in 30s");
    child.kill();
    process.exitCode = 1;
    return;
  }
  // 防 stale preview：served HTML 的 asset 指纹必须与本地 web-dist 一致。
  const [local, served] = await Promise.all([
    localAssetFingerprint(webIndex),
    servedAssetFingerprint(launchUrl),
  ]);
  if (local && served && local !== served) {
    console.error(
      `[zcode-serve] stale web dist: serving ${served} but local is ${local} (ZCODE_WEB_DIST mismatch?)`,
    );
    child.kill();
    process.exitCode = 1;
    return;
  }
  console.log(`[zcode-serve] ready: ${launchUrl}`);
  if (options.open) openBrowser(launchUrl);
  await new Promise((_, reject) => {
    child.on("exit", (code) => reject(new Error(`server exited with code ${code}`)));
  });
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
