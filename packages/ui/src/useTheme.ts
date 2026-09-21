import { useEffect, useState, useCallback } from "react";
import { getActiveCustomThemePlugin } from "@/themeCustom.js";

export type Theme = "light" | "dark" | "zai-light" | "zai-dark" | "custom" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "zcode-theme";
const BROWSER_THEME_SURFACE_ATTRIBUTE = "data-zcode-browser-theme-surface";

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === "system") {
    return getSystemTheme();
  }
  if (theme === "custom") {
    // 无 active 插件回落 dark；前景/基座与 applyTheme(custom) 同源。
    return getActiveCustomThemePlugin()?.dark === false ? "light" : "dark";
  }

  return theme === "dark" || theme === "zai-dark" ? "dark" : "light";
}

export function normalizeThemePreference(theme: Theme): Theme {
  if (theme === "dark") return "zai-dark";
  if (theme === "light") return "zai-light";
  return theme;
}

function setThemeMetaContent(name: "theme-color" | "color-scheme", content: string) {
  let meta = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = name;
    document.head.append(meta);
  }
  meta.content = content;
}

function syncBrowserThemeSurface(resolved: ResolvedTheme) {
  const root = document.documentElement;
  if (
    typeof root.hasAttribute !== "function" ||
    !root.hasAttribute(BROWSER_THEME_SURFACE_ATTRIBUTE)
  ) {
    return;
  }

  // Electron 为 vibrancy 保持透明根背景，但普通浏览器需要从文档根和标准 meta
  // 获得页面主题。只切换 React 的 dark class 会让浏览器工具栏、原生控件和 overscroll 留在旧主题。
  root.setAttribute(BROWSER_THEME_SURFACE_ATTRIBUTE, resolved);
  root.style.colorScheme = resolved;
  setThemeMetaContent("color-scheme", resolved);

  const background = getComputedStyle(root).getPropertyValue("--color-background").trim();
  if (background) {
    setThemeMetaContent("theme-color", background);
  }
}

export function applyTheme(theme: Theme) {
  const resolved = resolveTheme(theme);
  const appliedTheme =
    theme === "system"
      ? resolved === "dark"
        ? "zai-dark"
        : "zai-light"
      : normalizeThemePreference(theme);
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.classList.toggle("theme-zai-light", appliedTheme === "zai-light");
  document.documentElement.classList.toggle("theme-zai-dark", appliedTheme === "zai-dark");
  applyCustomThemeVars(theme);
  syncBrowserThemeSurface(resolved);
}

/**
 * 自定义主题 token 映射（spec p3 §2）：只覆盖颜色/表面，不碰字阶字号。
 * 未映射 token 回落基座 zai 类；停用时清除内联变量。
 */
function applyCustomThemeVars(theme: Theme) {
  const root = document.documentElement;
  const plugin = theme === "custom" ? getActiveCustomThemePlugin() : null;
  root.classList.toggle("theme-custom", plugin != null);
  const vars = [
    "--color-background",
    "--color-sidebar",
    "--color-card",
    "--color-popover",
    "--color-brand",
    "--color-accent",
    "--color-foreground",
  ];
  if (!plugin) {
    for (const name of vars) root.style.removeProperty(name);
    return;
  }
  // 基座类保证未映射 token 不断裂：dark 插件走 zai-dark，反之 zai-light。
  root.classList.toggle("theme-zai-dark", plugin.dark !== false);
  root.classList.toggle("theme-zai-light", plugin.dark === false);
  root.classList.toggle("dark", plugin.dark !== false);
  const foreground = plugin.dark === false ? "#171717" : "#f5f5f5";
  const mapping: Record<string, string> = {
    "--color-background": plugin.preview.background,
    "--color-sidebar": plugin.preview.background,
    "--color-card": plugin.preview.background,
    "--color-popover": plugin.preview.background,
    "--color-brand": plugin.preview.primary,
    "--color-accent": plugin.preview.secondary,
    "--color-foreground": foreground,
  };
  for (const [name, value] of Object.entries(mapping)) {
    root.style.setProperty(name, value);
  }
}

function isTheme(value: string | null): value is Theme {
  return (
    value === "light" ||
    value === "dark" ||
    value === "zai-light" ||
    value === "zai-dark" ||
    value === "custom" ||
    value === "system"
  );
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    // 默认主题统一收敛到 Zai dark，避免旧 hook 兜底值和 Zustand store 默认值分叉。
    return isTheme(saved) ? normalizeThemePreference(saved) : "zai-dark";
  });

  const setTheme = useCallback((t: Theme) => {
    const normalizedTheme = normalizeThemePreference(t);
    localStorage.setItem(STORAGE_KEY, normalizedTheme);
    setThemeState(normalizedTheme);
    applyTheme(normalizedTheme);
  }, []);

  // 初始化 + system 模式下监听系统偏好变化
  useEffect(() => {
    applyTheme(theme);

    if (theme !== "system") return;

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  return { theme, setTheme } as const;
}
