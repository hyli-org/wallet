import { defineCustomElement } from "vue";

import WebComponent from "./components/WebComponent.ce.vue";

import HyliWallet from "./components/HyliWallet.vue";
import WalletProvider from "./components/WalletProvider.vue";

// re-export the main component for Vue usage
export { HyliWallet, WalletProvider };

// convert into custom element constructor
const HyliWalletElement = defineCustomElement(WebComponent);

// register
customElements.define("hyli-wallet", HyliWalletElement);
