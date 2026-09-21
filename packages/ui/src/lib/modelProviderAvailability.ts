import type { ModelSelectionView } from "@zcode/services";

interface ProviderAvailabilityState {
  readonly source: "registry";
  readonly hydrated: boolean;
  readonly providerCount: number;
  readonly hasUsableProvider: boolean;
  /** 可用的免费中转渠道（P4 Kilo）：免登录进入的依据，不需要 domain/user。 */
  readonly hasUsableFreeChannel: boolean;
}

export function resolveProviderAvailabilityState(params: {
  modelSelectionView: ModelSelectionView | null;
}): ProviderAvailabilityState {
  const providers = params.modelSelectionView?.providers ?? [];
  const usableProviders = providers.filter((provider) => provider.models.length > 0);
  return {
    source: "registry",
    hydrated: params.modelSelectionView !== null,
    providerCount: providers.length,
    hasUsableProvider: params.modelSelectionView !== null && usableProviders.length > 0,
    hasUsableFreeChannel:
      params.modelSelectionView !== null &&
      usableProviders.some((provider) => provider.config.channel?.free === true),
  };
}
