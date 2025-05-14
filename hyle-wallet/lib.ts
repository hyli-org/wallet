import React from 'react';
import { createRoot } from 'react-dom/client';
import { HyleWallet } from './src/components/HyleWallet';
import type { ProviderOption } from './src/hooks/useWallet';

class HyleWalletElement extends HTMLElement {
  connectedCallback() {
    const mountPoint = document.createElement('div');
    this.appendChild(mountPoint);

    const providersAttr = this.getAttribute('providers');
    const providers = providersAttr ? providersAttr.split(',') as ProviderOption[] : ["password" as ProviderOption];

    createRoot(mountPoint).render(React.createElement(HyleWallet, { providers }));
  }
}

customElements.define('hyle-wallet', HyleWalletElement);
