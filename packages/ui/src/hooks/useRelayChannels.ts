import { useCallback, useEffect, useState } from "react";
import type {
  IRelayChannelService,
  RelayChannelView,
  SaveRelayChannelInput,
} from "@zcode/services";
import { useServices } from "@/hooks/useServices.js";

export interface RelayChannelsState {
  readonly available: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  readonly channels: readonly RelayChannelView[];
  readonly refresh: () => Promise<void>;
  readonly saveChannel: (input: SaveRelayChannelInput) => Promise<RelayChannelView>;
  readonly deleteChannel: (providerId: string) => Promise<void>;
  readonly fetchModels: (
    providerId: string,
    groupId?: string | null,
    options?: { readonly selectedModels?: readonly string[]; readonly save?: boolean },
  ) => Promise<readonly string[]>;
  readonly service: IRelayChannelService | undefined;
}

/** 中转渠道 hook：旧 host 无此服务时 available=false，调用方降级隐藏入口。 */
export function useRelayChannels(): RelayChannelsState {
  const services = useServices();
  const service = services.relayChannelService;
  const [channels, setChannels] = useState<readonly RelayChannelView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!service) return;
    setLoading(true);
    setError(null);
    try {
      setChannels(await service.listChannels());
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [service]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveChannel = useCallback(
    async (input: SaveRelayChannelInput) => {
      if (!service) throw new Error("Relay Channel 服务不可用");
      const view = await service.saveChannel(input);
      await refresh();
      return view;
    },
    [service, refresh],
  );

  const deleteChannel = useCallback(
    async (providerId: string) => {
      if (!service) throw new Error("Relay Channel 服务不可用");
      await service.deleteChannel(providerId);
      await refresh();
    },
    [service, refresh],
  );

  const fetchModels = useCallback(
    async (
      providerId: string,
      groupId?: string | null,
      options?: { readonly selectedModels?: readonly string[]; readonly save?: boolean },
    ) => {
      if (!service) throw new Error("Relay Channel 服务不可用");
      return service.fetchChannelModels({
        providerId,
        groupId: groupId ?? null,
        ...(options?.selectedModels ? { selectedModels: [...options.selectedModels] } : {}),
        ...(options?.save !== undefined ? { save: options.save } : {}),
      });
    },
    [service],
  );

  return {
    available: service != null,
    loading,
    error,
    channels,
    refresh,
    saveChannel,
    deleteChannel,
    fetchModels,
    service,
  };
}
