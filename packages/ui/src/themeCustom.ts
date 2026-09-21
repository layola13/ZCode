import { useSyncExternalStore } from "react";

export interface ZThemePreview {
  readonly primary: string;
  readonly secondary: string;
  readonly background: string;
}

export interface ZThemePlugin {
  readonly id: string;
  readonly name: string;
  readonly source: "user-defined";
  readonly dark: boolean;
  readonly preview: ZThemePreview;
  readonly assets?: {
    readonly appBackgroundImage?: string;
  };
  readonly layout?: {
    readonly workspaceSurfaceOpacity?: number;
  };
}

const PLUGINS_KEY = "zcode-theme-custom-plugins";
const ACTIVE_KEY = "zcode-theme-custom-active";
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_IMPORT_BYTES = 16 * 1024 * 1024;

const HEX_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return HEX_PATTERN.test(trimmed) ? trimmed : null;
}

/** 导入校验：声明式字段，拒绝一切可执行/未知载荷。 */
export function normalizeImportedThemePlugin(input: unknown): ZThemePlugin {
  if (!isRecord(input)) throw new Error("主题文件不是合法 JSON 对象");
  const id = typeof input["id"] === "string" ? input["id"].trim() : "";
  const name = typeof input["name"] === "string" ? input["name"].trim() : "";
  if (!id || id.length > 64) throw new Error("主题 id 非法");
  if (!name || name.length > 80) throw new Error("主题名称非法");
  const preview = input["preview"];
  if (!isRecord(preview)) throw new Error("主题缺少 preview 三色");
  const primary = normalizeHex(preview["primary"]);
  const secondary = normalizeHex(preview["secondary"]);
  const background = normalizeHex(preview["background"]);
  if (!primary || !secondary || !background) throw new Error("preview 三色必须为 #rgb/#rrggbb");
  const assets = input["assets"];
  let appBackgroundImage: string | undefined;
  if (isRecord(assets) && assets["appBackgroundImage"] != null) {
    const url = assets["appBackgroundImage"];
    if (
      typeof url !== "string" ||
      (!url.startsWith("data:image/") && !url.startsWith("https://"))
    ) {
      throw new Error("背景图只支持 data:image 或 https");
    }
    if (url.length > MAX_IMAGE_BYTES * 1.4) throw new Error("背景图超过 6MiB");
    appBackgroundImage = url;
  }
  const layout = input["layout"];
  let workspaceSurfaceOpacity: number | undefined;
  if (isRecord(layout) && layout["workspaceSurfaceOpacity"] != null) {
    const opacity = Number(layout["workspaceSurfaceOpacity"]);
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
      throw new Error("workspaceSurfaceOpacity 必须在 0-1 之间");
    }
    workspaceSurfaceOpacity = opacity;
  }
  return {
    id,
    name,
    source: "user-defined",
    dark: input["dark"] !== false,
    preview: { primary, secondary, background },
    ...(appBackgroundImage ? { assets: { appBackgroundImage } } : {}),
    ...(workspaceSurfaceOpacity !== undefined ? { layout: { workspaceSurfaceOpacity } } : {}),
  };
}

function readPlugins(): ZThemePlugin[] {
  try {
    const raw = localStorage.getItem(PLUGINS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const plugins: ZThemePlugin[] = [];
    for (const item of parsed.slice(0, 100)) {
      try {
        const plugin = normalizeImportedThemePlugin(item);
        if (plugin.source === "user-defined") plugins.push(plugin);
      } catch {
        // 坏条目跳过，不阻断整体读取。
      }
    }
    return plugins;
  } catch {
    return [];
  }
}

let snapshot: readonly ZThemePlugin[] = readPlugins();
const listeners = new Set<() => void>();

function emit(): void {
  snapshot = readPlugins();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function listCustomThemePlugins(): readonly ZThemePlugin[] {
  return snapshot;
}

export function saveCustomThemePlugin(plugin: ZThemePlugin): void {
  const normalized = normalizeImportedThemePlugin({ ...plugin, source: "user-defined" });
  const next = [...readPlugins().filter((item) => item.id !== normalized.id), normalized];
  localStorage.setItem(PLUGINS_KEY, JSON.stringify(next));
  emit();
}

export function removeCustomThemePlugin(id: string): void {
  const next = readPlugins().filter((item) => item.id !== id);
  localStorage.setItem(PLUGINS_KEY, JSON.stringify(next));
  // 正在用的主题被删：只清 active 指向，回落由调用方经 useTheme.setTheme("zai-dark")
  // 完成（直接写 zcode-theme 键不会通知 useTheme state，会造成内外分叉）。
  if (getActiveCustomThemeId() === id) {
    localStorage.removeItem(ACTIVE_KEY);
  }
  emit();
}

export function getActiveCustomThemeId(): string | null {
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveCustomThemeId(id: string | null): void {
  if (id) localStorage.setItem(ACTIVE_KEY, id);
  else localStorage.removeItem(ACTIVE_KEY);
  emit();
}

export function getActiveCustomThemePlugin(): ZThemePlugin | null {
  const id = getActiveCustomThemeId();
  if (!id) return null;
  return readPlugins().find((plugin) => plugin.id === id) ?? null;
}

export function useCustomThemePlugins(): readonly ZThemePlugin[] {
  return useSyncExternalStore(subscribe, () => snapshot);
}

export function parseThemeImportFile(text: string): ZThemePlugin {
  if (text.length > MAX_IMPORT_BYTES) throw new Error("主题文件超过 16MiB");
  return normalizeImportedThemePlugin(JSON.parse(text));
}

export function serializeThemePlugin(plugin: ZThemePlugin): string {
  return `${JSON.stringify({ ...plugin, source: "user-defined" }, null, 2)}\n`;
}
