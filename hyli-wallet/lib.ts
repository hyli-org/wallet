import React from "react";
import { createRoot } from "react-dom/client";
import { HyliWallet } from "./src/components/HyliWallet";
import type { ProviderOption } from "./src/hooks/useWallet";

class HyliWalletElement extends HTMLElement {
    connectedCallback() {
        const mountPoint = document.createElement("div");
        this.appendChild(mountPoint);

        const providersAttr = this.getAttribute("providers");
        const providers = providersAttr
            ? (providersAttr.split(",") as ProviderOption[])
            : ["password" as ProviderOption];

        createRoot(mountPoint).render(React.createElement(HyliWallet, { providers }));
    }
}

customElements.define("hyli-wallet", HyliWalletElement);
