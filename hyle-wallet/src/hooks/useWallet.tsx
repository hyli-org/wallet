// useWallet hook and WalletProvider implementation
import React, { createContext, useContext, useState, useCallback } from 'react';
import type { Wallet } from '../types/wallet';
import type { AuthCredentials } from '../providers/BaseAuthProvider';
import { authProviderManager } from '../providers/AuthProviderManager';

export type ProviderOption = 'password' | 'google' | 'github' | 'x';

interface WalletContextType {
  wallet: Wallet | null;
  isLoading: boolean;
  error: string | null;
  login: (provider: ProviderOption, credentials: AuthCredentials) => Promise<void>;
  register: (provider: ProviderOption, credentials: AuthCredentials) => Promise<void>;
  logout: () => void;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clear = () => {
    setWallet(null);
    setError(null);
  };

  const login = useCallback(async (provider: ProviderOption, credentials: AuthCredentials) => {
    const authProvider = authProviderManager.getProvider(provider);
    if (!authProvider) {
      setError(`Provider ${provider} not found`);
      return;
    }
    try {
      setIsLoading(true);
      setError(null);
      const result = await authProvider.login(credentials as any);
      if (result.success && result.wallet) {
        setWallet(result.wallet);
      } else {
        setError(result.error ?? 'Login failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const register = useCallback(async (provider: ProviderOption, credentials: AuthCredentials) => {
    const authProvider = authProviderManager.getProvider(provider);
    if (!authProvider) {
      setError(`Provider ${provider} not found`);
      return;
    }
    try {
      setIsLoading(true);
      setError(null);
      const result = await authProvider.register(credentials as any);
      if (result.success && result.wallet) {
        setWallet(result.wallet);
      } else {
        setError(result.error ?? 'Registration failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Registration failed');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    clear();
  }, []);

  return (
    <WalletContext.Provider value={{ wallet, isLoading, error, login, register, logout }}>
      {children}
    </WalletContext.Provider>
  );
};

export const useWallet = (): WalletContextType => {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return ctx;
}; 