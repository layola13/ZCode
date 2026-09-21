import { memo, useState } from "react";
import { Button } from "@/components/ui/button.js";
import { useZCodeSessionStore } from "@/store/zcodeSessionStore.js";

interface FreeCompactControlProps {
  workspacePath: string;
  workspaceIdentity?: string;
  taskId: string | null;
  /** 当前上下文使用百分比（0-100），无数据为 null。 */
  usagePercent: number | null;
  disabled?: boolean;
  onCompactNow: () => void;
}

/** 省钱压缩 `$`：per-task 阈值偏好 + 手动触发（spec p2 §2）。 */
function FreeCompactControlImpl({
  workspacePath,
  workspaceIdentity,
  taskId,
  usagePercent,
  disabled = false,
  onCompactNow,
}: FreeCompactControlProps) {
  const [open, setOpen] = useState(false);
  const preference = useZCodeSessionStore((state) =>
    taskId
      ? (state.getWorkspaceState(workspacePath, workspaceIdentity).taskFreeCompactByTaskId[
          taskId
        ] ?? null)
      : null,
  );
  const setTaskFreeCompact = useZCodeSessionStore((state) => state.setTaskFreeCompact);

  const enabled = preference?.enabled ?? false;
  const threshold = preference?.threshold ?? 80;
  const reached = usagePercent != null && usagePercent >= threshold;

  function update(next: { enabled: boolean; threshold: number }) {
    if (!taskId) return;
    setTaskFreeCompact(workspacePath, taskId, next, workspaceIdentity);
  }

  return (
    <span className="relative flex items-center">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        aria-label="省钱压缩"
        title={
          usagePercent == null
            ? "省钱压缩（暂无上下文数据）"
            : `省钱压缩：已用 ${Math.round(usagePercent)}% / 阈值 ${threshold}%`
        }
        onClick={() => setOpen((value) => !value)}
        className={reached && enabled ? "text-warning" : undefined}
      >
        $
      </Button>
      {open ? (
        <span className="absolute bottom-9 left-0 z-50 flex w-56 flex-col gap-2 rounded-lg border border-border bg-popover p-3 shadow-md">
          <label className="flex items-center gap-2 text-ui-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => update({ enabled: event.target.checked, threshold })}
            />
            发送前自动压缩
          </label>
          <label className="flex flex-col gap-1 text-ui-sm">
            阈值：{threshold}%
            <input
              type="range"
              min={50}
              max={95}
              value={threshold}
              onChange={(event) => update({ enabled, threshold: Number(event.target.value) })}
            />
          </label>
          <Button
            size="xs"
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              onCompactNow();
              setOpen(false);
            }}
          >
            立即压缩
          </Button>
        </span>
      ) : null}
    </span>
  );
}

export const FreeCompactControl = memo(FreeCompactControlImpl);
