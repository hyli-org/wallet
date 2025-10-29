import { createStore, EIP6963ProviderDetail } from "mipd";

type ProviderStore = ReturnType<typeof createStore>;

const listeners = new Set<() => void>();

let store: ProviderStore | null = null;
let cachedProviders: EIP6963ProviderDetail[] = [];
let unsubscribeFromStore: (() => void) | undefined;
let hasRequestedProviders = false;

const canUseDom = () => typeof window !== "undefined";

const ensureStore = (): ProviderStore | null => {
    if (!canUseDom()) {
        return null;
    }

    if (!store) {
        const nextStore = createStore();
        store = nextStore;
        cachedProviders = nextStore.getProviders() as EIP6963ProviderDetail[];
        unsubscribeFromStore = nextStore.subscribe(providerDetails => {
            cachedProviders = providerDetails as EIP6963ProviderDetail[];
            listeners.forEach(listener => listener());
        });
    }

    return store;
};

const requestProviders = () => {
    const currentStore = ensureStore();
    if (!currentStore || hasRequestedProviders) {
        return;
    }

    currentStore.reset();
    hasRequestedProviders = true;
};

export const initializeEthereumProviders = () => {
    if (!canUseDom()) {
        return;
    }
    requestProviders();
};

export const getEthereumProviders = (): EIP6963ProviderDetail[] => {
    if (!canUseDom()) {
        return [];
    }

    ensureStore();
    return cachedProviders;
};

export const subscribeToEthereumProviders = (listener: () => void): (() => void) => {
    if (!canUseDom()) {
        return () => {};
    }

    ensureStore();
    listeners.add(listener);
    requestProviders();

    return () => {
        listeners.delete(listener);
    };
};

export const findEthereumProviderByUuid = (uuid: string): EIP6963ProviderDetail | undefined => {
    return getEthereumProviders().find(provider => provider.info.uuid === uuid);
};

export const findEthereumProviderByWalletId = (uuid: string): EIP6963ProviderDetail | undefined => {
    return getEthereumProviders().find(provider => provider.info.uuid === uuid);
};

export const clearEthereumProviders = () => {
    cachedProviders = [];
    hasRequestedProviders = false;
    listeners.forEach(listener => listener());
};

export const disposeEthereumProviders = () => {
    unsubscribeFromStore?.();
    unsubscribeFromStore = undefined;
    store?.destroy();
    store = null;
    cachedProviders = [];
    listeners.clear();
    hasRequestedProviders = false;
};
