#!/usr/bin/env node
// ZCode server 单文件 bundle（cxu 式 launcher 分发用）。
// external 表与 packages/server/tsup.config.ts 的 SERVER_HTTP_EXTERNAL_DEPENDENCIES
// 保持一致（改动时两边同步，原因见该文件注释：native addon 与 CJS 动态 require）。
// define 与 tsup 的 SERVER_HTTP_DEFINES 同源（根 package.json 版本 + builtin 配置）。
import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { loadBuiltinProviderConfig } from "./builtin-provider-config.mjs";

const root = resolve(import.meta.dirname, "..");
const defaultOutDir = resolve(root, "dist", "server-bundle");

// 与 packages/server/tsup.config.ts SERVER_HTTP_EXTERNAL_DEPENDENCIES 同步。
// 另加 "ws"：CJS 的 ws 被 esbuild 内联进 ESM 后命中 require("events") 动态 require，
// 启动即崩；build-zcode 的 copyRuntimeNodeModules 已统一外置运行时依赖，launcher 侧同理提供。
const SERVER_BUNDLE_EXTERNAL = [
  "ssh2",
  "node-pty",
  "undici",
  "axios",
  "form-data",
  "combined-stream",
  "proxy-from-env",
  "follow-redirects",
  "node-forge",
  "yaml",
  "yazl",
  "yauzl",
  "ws",
];

const usage = `Usage:
  node scripts/build-server-bundle.mjs
  node scripts/build-server-bundle.mjs --out dist/server-bundle
  node scripts/build-server-bundle.mjs --verify-only [--out dist/server-bundle]

Options:
  --out <dir>    Output directory. Defaults to dist/server-bundle.
  --verify-only  Only run artifact hygiene checks on an existing bundle.
  --help, -h     Show this help.
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
  const options = { help: false, outDir: defaultOutDir, verifyOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--verify-only") {
      options.verifyOnly = true;
      continue;
    }
    if (arg === "--out" || arg.startsWith("--out=")) {
      const { nextIndex, value } = readArgValue(argv, arg, index);
      options.outDir = resolve(root, value);
      index = nextIndex;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function formatBytes(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} kB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

// 产物卫生：禁 sourcemap（ultra verify-production-artifacts 的最小子集）。
async function verifyBundleHygiene(outDir) {
  const entries = await readdir(outDir);
  const violations = [];
  for (const entry of entries) {
    if (entry.endsWith(".map")) {
      violations.push(`${entry}: unexpected sourcemap file`);
    }
  }
  const bundlePath = resolve(outDir, "index.js");
  const content = await readFile(bundlePath, "utf-8");
  if (content.includes("sourceMappingURL")) {
    violations.push("index.js: contains sourceMappingURL marker");
  }
  if (violations.length > 0) {
    throw new Error(`Bundle hygiene failed:\n${violations.map((v) => `  - ${v}`).join("\n")}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage);
    return;
  }
  if (options.verifyOnly) {
    await verifyBundleHygiene(options.outDir);
    console.log(`Bundle hygiene OK: ${options.outDir}`);
    return;
  }

  const { version } = JSON.parse(await readFile(resolve(root, "package.json"), "utf-8"));
  const { environment: zcodeEnv, content: zcodeBuiltinProviderConfigJson } =
    await loadBuiltinProviderConfig();

  await rm(options.outDir, { recursive: true, force: true });
  const outfile = resolve(options.outDir, "index.js");
  const result = await build({
    entryPoints: [resolve(root, "packages/server/src/entry-http.ts")],
    outfile,
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    sourcemap: false,
    legalComments: "none",
    external: SERVER_BUNDLE_EXTERNAL,
    define: {
      __ZCODE_VERSION__: JSON.stringify(version),
      __ZCODE_ENV__: JSON.stringify(zcodeEnv),
      __ZCODE_BUILTIN_PROVIDER_CONFIG_JSON__: JSON.stringify(zcodeBuiltinProviderConfigJson),
    },
    metafile: true,
  });
  const bytes = Object.values(result.metafile.outputs).reduce(
    (sum, output) => sum + output.bytes,
    0,
  );
  await writeFile(
    resolve(options.outDir, ".build-info.json"),
    `${JSON.stringify({ version, builtAt: new Date().toISOString(), entry: "packages/server/src/entry-http.ts", external: SERVER_BUNDLE_EXTERNAL }, null, 2)}\n`,
  );
  await verifyBundleHygiene(options.outDir);
  const { size } = await stat(outfile);
  console.log(
    `Server bundle wrote ${formatBytes(bytes)} (file ${formatBytes(size)}) to ${outfile}`,
  );
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
