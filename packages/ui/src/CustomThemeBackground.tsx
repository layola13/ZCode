import { memo } from "react";
import { getActiveCustomThemePlugin, useCustomThemePlugins } from "@/themeCustom.js";
import { useTheme } from "@/useTheme.js";

/** 自定义主题背景层：挂 RootShell 首节点，无图不渲染。 */
function CustomThemeBackgroundImpl() {
  const { theme } = useTheme();
  useCustomThemePlugins();
  if (theme !== "custom") return null;
  const plugin = getActiveCustomThemePlugin();
  const image = plugin?.assets?.appBackgroundImage;
  if (!image) return null;
  const opacity = plugin?.layout?.workspaceSurfaceOpacity ?? 0.35;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 bg-cover bg-center"
      style={{ backgroundImage: `url("${image.replace(/"/g, "%22")}")`, opacity }}
    />
  );
}

export const CustomThemeBackground = memo(CustomThemeBackgroundImpl);
