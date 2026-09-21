import { memo, useCallback, useEffect, useMemo } from "react";
import type { RelayChannelSelection } from "@zcode/services";
import { useServices } from "@/hooks/useServices.js";
import { useRelayChannels } from "@/hooks/useRelayChannels.js";
import { useZCodeSessionStore } from "@/store/zcodeSessionStore.js";
import { logger } from "@/logger.js";

interface RelayChannelControlsProps {
  workspacePath: string;
  workspaceIdentity?: string;
  /** 当前 task；null=草稿态，只读展示不持久化服务端。 */
  taskId: string | null;
  disabled?: boolean;
}

/** Composer 渠道 chip：渠道→分组→模型三级选择，per-task 独立。 */
function RelayChannelControlsImpl({
  workspacePath,
  workspaceIdentity,
  taskId,
  disabled = false,
}: RelayChannelControlsProps) {
  const { available, channels } = useRelayChannels();
  const services = useServices();
  const selection = useZCodeSessionStore((state) =>
    taskId
      ? (state.getWorkspaceState(workspacePath, workspaceIdentity).taskRelaySelectionByTaskId[
          taskId
        ] ?? null)
      : null,
  );
  const setTaskRelaySelection = useZCodeSessionStore((state) => state.setTaskRelaySelection);

  const activeChannel = useMemo(
    () => channels.find((channel) => channel.providerId === selection?.providerId) ?? null,
    [channels, selection],
  );
  const activeGroup = useMemo(
    () =>
      activeChannel?.groups.find(
        (group) => group.groupId === (selection?.groupId ?? activeChannel.groups[0]?.groupId),
      ) ??
      activeChannel?.groups[0] ??
      null,
    [activeChannel, selection],
  );

  // 服务端权威同步：taskId 即 selection key（与 relay 服务约定）。
  useEffect(() => {
    if (!taskId || !services.relayChannelService) return;
    const service = services.relayChannelService;
    service.setThreadSelection(taskId, selection).catch((error: unknown) =>
      logger.warn("[relay] thread selection 同步失败", {
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }, [taskId, selection, services]);

  const update = useCallback(
    (next: RelayChannelSelection | null) => {
      if (!taskId) return;
      setTaskRelaySelection(workspacePath, taskId, next, workspaceIdentity);
    },
    [taskId, setTaskRelaySelection, workspacePath, workspaceIdentity],
  );

  if (!available || channels.length === 0) return null;

  const selectClass =
    "max-w-28 truncate rounded-md border border-transparent bg-transparent px-1 py-0.5 text-ui-sm text-foreground-subtle hover:border-border hover:text-foreground";

  return (
    <span className="flex min-w-0 items-center gap-0.5" aria-label="中转渠道选择">
      <select
        className={selectClass}
        value={selection?.providerId ?? ""}
        disabled={disabled}
        onChange={(event) => {
          const providerId = event.target.value;
          update(providerId ? { providerId } : null);
        }}
        title="中转渠道（空=内置）"
      >
        <option value="">内置</option>
        {channels.map((channel) => (
          <option key={channel.providerId} value={channel.providerId}>
            {channel.providerName}
          </option>
        ))}
      </select>
      {activeChannel && activeChannel.groups.length > 0 ? (
        <select
          className={selectClass}
          value={selection?.groupId ?? activeChannel.groups[0]?.groupId ?? ""}
          disabled={disabled}
          onChange={(event) =>
            update({ providerId: activeChannel.providerId, groupId: event.target.value || null })
          }
          title="渠道分组"
        >
          {activeChannel.groups.map((group) => (
            <option key={group.groupId} value={group.groupId}>
              {group.groupName}
              {group.groupRatio === 0 ? "免费" : `×${group.groupRatio}`}
            </option>
          ))}
        </select>
      ) : null}
      {activeGroup && activeGroup.models.length > 0 ? (
        <select
          className={selectClass}
          value={selection?.model ?? ""}
          disabled={disabled}
          onChange={(event) =>
            update({
              providerId: activeChannel!.providerId,
              groupId: activeGroup.groupId,
              model: event.target.value || null,
            })
          }
          title="渠道模型"
        >
          <option value="">自动</option>
          {activeGroup.models.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
      ) : null}
    </span>
  );
}

export const RelayChannelControls = memo(RelayChannelControlsImpl);
