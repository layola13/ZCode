import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { atomicWritePrivateTextFile, withFileLock } from "@zcode/shared/node";
import { relayChannelSelectionSchema, type RelayChannelSelection } from "@zcode/provider";

interface ThreadSelectionFile {
  readonly version: 1;
  readonly selections: Record<string, RelayChannelSelection>;
}

function selectionFilePath(dataDir: string): string {
  return join(dataDir, "relay", "thread-relay-selection.json");
}

async function readSelectionFile(filePath: string): Promise<ThreadSelectionFile> {
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, "utf-8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as { version?: unknown }).version === 1 &&
      typeof (parsed as { selections?: unknown }).selections === "object"
    ) {
      return parsed as ThreadSelectionFile;
    }
  } catch {
    // 缺失或损坏都视为空选择；损坏文件不自动覆盖，由下次写入替换。
  }
  return { version: 1, selections: {} };
}

export interface ThreadSelectionStore {
  readonly get: (threadId: string) => Promise<RelayChannelSelection | null>;
  readonly set: (
    threadId: string,
    selection: RelayChannelSelection | null,
  ) => Promise<RelayChannelSelection | null>;
}

/** per-thread 选择存储：文件归 relay 服务所有，UI 只做缓存（spec P1 §1）。 */
export function createThreadSelectionStore(dataDir: string): ThreadSelectionStore {
  return {
    async get(threadId: string): Promise<RelayChannelSelection | null> {
      const id = threadId.trim();
      if (!id) return null;
      const file = await readSelectionFile(selectionFilePath(dataDir));
      return file.selections[id] ?? null;
    },
    async set(
      threadId: string,
      selection: RelayChannelSelection | null,
    ): Promise<RelayChannelSelection | null> {
      const id = threadId.trim();
      if (!id) throw new Error("threadId 不能为空");
      const parsed = selection == null ? null : relayChannelSelectionSchema.parse(selection);
      const filePath = selectionFilePath(dataDir);
      await withFileLock(filePath, async () => {
        const file = await readSelectionFile(filePath);
        const selections = { ...file.selections };
        if (parsed == null) delete selections[id];
        else selections[id] = parsed;
        await atomicWritePrivateTextFile(
          filePath,
          `${JSON.stringify({ version: 1, selections }, null, 2)}\n`,
        );
      });
      return parsed;
    },
  };
}
