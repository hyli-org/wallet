import type { ProviderOption } from "./provider";

export type EthereumProviderRequest = {
    reason?: string;
    /**
     * Provider that should be directly selected in the modal (skips provider list).
     */
    preselectProvider?: ProviderOption;
    /**
     * Provider family the modal should focus on (keeps the provider list visible).
     */
    requestedProvider?: ProviderOption;
    ethereumProviderUuid?: string | null;
};
