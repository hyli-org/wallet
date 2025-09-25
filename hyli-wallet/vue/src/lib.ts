import { defineCustomElement } from "vue";

import WebComponent from "./components/WebComponent.ce.vue";

import HyliWallet from "./components/HyliWallet.vue";
import WalletProvider from "./components/WalletProvider.vue";
import {
    setWalletConfig,
    useWalletInternal,
    useWallet,
    walletKey,
    type WalletProviderProps,
} from "./composables/useWallet";

// re-export the main component for Vue usage
export {
    HyliWallet,
    WalletProvider,
    setWalletConfig,
    useWalletInternal,
    useWallet,
    walletKey,
    type WalletProviderProps,
};

// convert into custom element constructor
const HyliWalletElement = defineCustomElement(WebComponent);

// register
customElements.define("hyli-wallet-web", HyliWalletElement);
