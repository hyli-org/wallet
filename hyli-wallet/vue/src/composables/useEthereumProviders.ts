import { onBeforeUnmount, onMounted, ref } from "vue";
import {
    getEthereumProviders,
    initializeEthereumProviders,
    subscribeToEthereumProviders,
} from "hyli-wallet";
import type { EIP6963ProviderDetail } from "mipd";

export function useEthereumProviders() {
    const providers = ref<EIP6963ProviderDetail[]>(getEthereumProviders());
    let unsubscribe: (() => void) | undefined;

    const updateProviders = () => {
        providers.value = getEthereumProviders();
    };

    onMounted(() => {
        initializeEthereumProviders();
        unsubscribe = subscribeToEthereumProviders(updateProviders);
        updateProviders();
    });

    onBeforeUnmount(() => {
        unsubscribe?.();
        unsubscribe = undefined;
    });

    return providers;
}
