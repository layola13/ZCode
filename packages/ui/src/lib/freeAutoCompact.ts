import type { FreeCompactPreference } from "@/store/zcodeSessionStoreTypes.js";

export const FREE_COMPACT_COOLDOWN_MS = 60_000;

export interface FreeAutoCompactContext {
  /** 会话 task key；null=草稿态，不触发。 */
  readonly taskId: string | null;
  /** 上下文使用百分比（0-100）；null=无数据，不触发。 */
  readonly usagePercent: number | null;
  /** 会话 phase；running=有运行中 turn，不触发。 */
  readonly phase: string | null;
  readonly preference: FreeCompactPreference | null | undefined;
  readonly now?: number;
}

/**
 * 省钱压缩发送前 barrier（spec p2 §2）。
 * 返回 "compacted" 时调用方必须拦截本次发送（返回 blocked，草稿保留）。
 */
export async function maybeRunFreeAutoCompact(
  context: FreeAutoCompactContext,
  dispatchCompact: () => Promise<unknown>,
): Promise<"compacted" | "pass"> {
  if (context.taskId == null) return "pass";
  const preference = context.preference;
  if (!preference?.enabled) return "pass";
  if (context.usagePercent == null) return "pass";
  const threshold =
    Number.isFinite(preference.threshold) &&
    preference.threshold >= 50 &&
    preference.threshold <= 95
      ? preference.threshold
      : 80;
  if (context.usagePercent < threshold) return "pass";
  if (context.phase === "running") return "pass";
  const now = context.now ?? Date.now();
  if (preference.lastRunAt != null && now - preference.lastRunAt < FREE_COMPACT_COOLDOWN_MS) {
    return "pass";
  }
  await dispatchCompact();
  return "compacted";
}
