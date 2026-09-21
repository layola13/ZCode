import { useRef, useState } from "react";
import { Button } from "@/components/ui/button.js";
import {
  getActiveCustomThemeId,
  normalizeImportedThemePlugin,
  parseThemeImportFile,
  removeCustomThemePlugin,
  saveCustomThemePlugin,
  serializeThemePlugin,
  setActiveCustomThemeId,
  useCustomThemePlugins,
  type ZThemePlugin,
} from "@/themeCustom.js";
import { applyTheme, type Theme } from "@/useTheme.js";

interface Draft {
  id: string;
  name: string;
  dark: boolean;
  primary: string;
  secondary: string;
  background: string;
  image: string;
  opacity: string;
}

function toDraft(plugin?: ZThemePlugin): Draft {
  return {
    id: plugin?.id ?? `custom-${Date.now().toString(36)}`,
    name: plugin?.name ?? "",
    dark: plugin?.dark !== false,
    primary: plugin?.preview.primary ?? "#4f8cff",
    secondary: plugin?.preview.secondary ?? "#8e33ff",
    background: plugin?.preview.background ?? "#161616",
    image: plugin?.assets?.appBackgroundImage ?? "",
    opacity:
      plugin?.layout?.workspaceSurfaceOpacity !== undefined
        ? String(plugin.layout.workspaceSurfaceOpacity)
        : "",
  };
}

function readImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > 6 * 1024 * 1024) {
      reject(new Error("背景图超过 6MiB"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

export function CustomThemeSection({
  theme,
  setTheme,
}: {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}) {
  const plugins = useCustomThemePlugins();
  const activeId = getActiveCustomThemeId();
  const [editing, setEditing] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);

  function applyPlugin(plugin: ZThemePlugin) {
    setActiveCustomThemeId(plugin.id);
    setTheme("custom");
    applyTheme("custom");
  }

  function handleDelete(id: string) {
    const wasActive = getActiveCustomThemeId() === id && theme === "custom";
    removeCustomThemePlugin(id);
    // 正在用的主题被删：C3 回落 zai-dark，不白屏。
    if (wasActive) setTheme("zai-dark");
  }

  function handleSave() {
    if (!editing) return;
    setError(null);
    try {
      const opacity = editing.opacity.trim() ? Number(editing.opacity) : undefined;
      const plugin = normalizeImportedThemePlugin({
        id: editing.id.trim(),
        name: editing.name.trim(),
        dark: editing.dark,
        preview: {
          primary: editing.primary,
          secondary: editing.secondary,
          background: editing.background,
        },
        ...(editing.image.trim() ? { assets: { appBackgroundImage: editing.image.trim() } } : {}),
        ...(opacity !== undefined ? { layout: { workspaceSurfaceOpacity: opacity } } : {}),
      });
      saveCustomThemePlugin(plugin);
      setEditing(null);
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }

  function handleExport(plugin: ZThemePlugin) {
    const blob = new Blob([serializeThemePlugin(plugin)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${plugin.id}.theme.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportFile(file: File) {
    setError(null);
    try {
      if (file.size > 16 * 1024 * 1024) throw new Error("主题文件超过 16MiB");
      const plugin = parseThemeImportFile(await file.text());
      saveCustomThemePlugin(plugin);
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-ui-lg font-semibold text-foreground">自定义主题</h3>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()}>
            导入 JSON
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setEditing(toDraft());
              setError(null);
            }}
          >
            新建主题
          </Button>
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleImportFile(file);
          event.target.value = "";
        }}
      />
      {error ? <p className="text-ui-sm text-destructive">{error}</p> : null}
      {plugins.length === 0 && !editing ? (
        <p className="text-ui-sm text-foreground-subtle">
          暂无自定义主题。preview 三色映射到底色/品牌色/点缀色，其余 token 回落 Zai 基座。
        </p>
      ) : null}
      {plugins.map((plugin) => {
        const isActive = theme === "custom" && activeId === plugin.id;
        return (
          <div
            key={plugin.id}
            className="flex items-center justify-between rounded-lg border border-border p-3"
          >
            <div className="flex items-center gap-2">
              <span
                className="size-5 rounded-full border border-border"
                style={{ background: plugin.preview.primary }}
              />
              <span
                className="size-5 rounded-full border border-border"
                style={{ background: plugin.preview.secondary }}
              />
              <span
                className="size-5 rounded-full border border-border"
                style={{ background: plugin.preview.background }}
              />
              <span className="text-ui-base font-medium">{plugin.name}</span>
              {isActive ? <span className="text-ui-xs text-foreground-subtle">使用中</span> : null}
            </div>
            <div className="flex gap-2">
              {!isActive ? (
                <Button size="xs" variant="ghost" onClick={() => applyPlugin(plugin)}>
                  应用
                </Button>
              ) : null}
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  setEditing(toDraft(plugin));
                  setError(null);
                }}
              >
                编辑
              </Button>
              <Button size="xs" variant="ghost" onClick={() => handleExport(plugin)}>
                导出
              </Button>
              <Button size="xs" variant="ghost" onClick={() => handleDelete(plugin.id)}>
                删除
              </Button>
            </div>
          </div>
        );
      })}
      {editing ? (
        <div className="grid grid-cols-2 gap-2 rounded-lg border border-border p-3">
          <label className="flex flex-col gap-1 text-ui-sm">
            名称
            <input
              className="rounded-md border border-input bg-input px-2 py-1 text-ui-sm"
              value={editing.name}
              onChange={(event) => setEditing({ ...editing, name: event.target.value })}
            />
          </label>
          <label className="flex items-center gap-2 text-ui-sm">
            <input
              type="checkbox"
              checked={editing.dark}
              onChange={(event) => setEditing({ ...editing, dark: event.target.checked })}
            />
            深色基座
          </label>
          {(["primary", "secondary", "background"] as const).map((key) => (
            <label key={key} className="flex items-center gap-2 text-ui-sm">
              <input
                type="color"
                value={editing[key]}
                onChange={(event) => setEditing({ ...editing, [key]: event.target.value })}
              />
              {key === "primary" ? "品牌色" : key === "secondary" ? "点缀色" : "底色"}
              <span className="text-ui-xs text-foreground-subtle">{editing[key]}</span>
            </label>
          ))}
          <label className="col-span-2 flex flex-col gap-1 text-ui-sm">
            背景图（≤6MiB，留空无背景）
            <div className="flex gap-2">
              <input
                className="flex-1 rounded-md border border-input bg-input px-2 py-1 text-ui-sm"
                value={editing.image}
                placeholder="https://… 或上传本地图片"
                onChange={(event) => setEditing({ ...editing, image: event.target.value })}
              />
              <Button size="xs" variant="ghost" onClick={() => imageRef.current?.click()}>
                上传
              </Button>
            </div>
            <input
              ref={imageRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                readImageFile(file)
                  .then((url) => setEditing((draft) => (draft ? { ...draft, image: url } : draft)))
                  .catch((error: unknown) =>
                    setError(error instanceof Error ? error.message : String(error)),
                  );
                event.target.value = "";
              }}
            />
          </label>
          <label className="flex flex-col gap-1 text-ui-sm">
            背景不透明度（0-1，留空默认）
            <input
              className="rounded-md border border-input bg-input px-2 py-1 text-ui-sm"
              value={editing.opacity}
              placeholder="0.35"
              onChange={(event) => setEditing({ ...editing, opacity: event.target.value })}
            />
          </label>
          <div className="col-span-2 flex gap-2">
            <Button size="sm" onClick={handleSave}>
              保存
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
              取消
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
