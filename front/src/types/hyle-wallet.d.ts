declare module 'hyle-wallet' {
  import * as React from 'react';
  import type { Wallet } from './wallet';

  export type ProviderOption = 'password' | 'google' | 'github' | 'x';

  export interface HyleWalletProps {
    providers?: ProviderOption[];
    button?: (props: { onClick: () => void }) => React.ReactNode;
    onWalletConnected?: (wallet: Wallet) => void;
  }

  export const HyleWallet: React.FC<HyleWalletProps>;

  export interface WalletProviderProps {
    children: React.ReactNode;
  }

  export const WalletProvider: React.FC<WalletProviderProps>;

  export interface UseWalletReturn {
    wallet: Wallet | null;
    isLoading: boolean;
    error: string | null;
    login: (provider: ProviderOption, credentials: any) => Promise<void>;
    register: (provider: ProviderOption, credentials: any) => Promise<void>;
    logout: () => void;
  }

  export function useWallet(): UseWalletReturn;

  export interface UseSessionKeyReturn {
    generateSessionKey: () => string;
    clearSessionKey: (publicKey: string) => void;
    createSignedBlobs: (account: string, key: string, message: string) => [any, any];
  }

  export function useSessionKey(): UseSessionKeyReturn;
} 