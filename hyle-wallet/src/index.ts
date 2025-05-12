import React from 'react';
import { createRoot } from 'react-dom/client';
import { HyleWallet, ProviderOption } from './components/HyleWallet';

// Export the React component directly
export { HyleWallet } from './components/HyleWallet';
export { PasswordAuthProvider } from './providers/PasswordAuthProvider';
export type { AuthProvider, AuthCredentials } from './types/auth';
export type { Wallet, Transaction } from './types/wallet';
export type { ProviderOption };
export { WalletProvider, useWallet } from './hooks/useWallet';
export { useSessionKey } from './hooks/useSessionKey';

// Register the Web Component
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
