import { defineCustomElement } from "vue";

import WebComponent from "./components/WebComponent.ce.vue";

import HyliWallet from "./components/HyliWallet.vue";
import WalletProvider from "./components/WalletProvider.vue";
import { useEthereumProviders } from "./composables/useEthereumProviders";
import { setWalletConfig, useWalletInternal, useWallet, type WalletProviderProps } from "./composables/useWallet";
import {
    initializeEthereumProviders,
    getEthereumProviders,
    subscribeToEthereumProviders,
    findEthereumProviderByUuid,
    findEthereumProviderByWalletId,
} from "hyli-wallet";

// re-export the main component for Vue usage
export {
    HyliWallet,
    WalletProvider,
    useEthereumProviders,
    initializeEthereumProviders,
    getEthereumProviders,
    subscribeToEthereumProviders,
    findEthereumProviderByUuid,
    findEthereumProviderByWalletId,
    setWalletConfig,
    useWalletInternal,
    useWallet,
    type WalletProviderProps,
};

// convert into custom element constructor
const HyliWalletElement = defineCustomElement(WebComponent);

// register
customElements.define("hyli-wallet-web", HyliWalletElement);
