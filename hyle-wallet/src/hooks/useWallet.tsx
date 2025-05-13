// useWallet hook and WalletProvider implementation
import React, { createContext, useContext, useState, useCallback } from 'react';
import type { Wallet } from '../types/wallet';
import type { AuthCredentials } from '../providers/BaseAuthProvider';
import { authProviderManager } from '../providers/AuthProviderManager';
import { AuthStage } from '../types/login';

export type ProviderOption = 'password' | 'google' | 'github' | 'x';

interface WalletContextType {
  wallet: Wallet | null;
  isLoading: boolean;
  error: string | null;
  stage: AuthStage;
  login: (provider: ProviderOption, credentials: AuthCredentials) => Promise<void>;
  register: (provider: ProviderOption, credentials: AuthCredentials) => Promise<void>;
  logout: () => void;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [wallet, setWallet] = useState<Wallet | null>(() => {
    const storedWallet = localStorage.getItem('wallet');
    return storedWallet ? JSON.parse(storedWallet) : null;
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<AuthStage>('idle');

  // Persist wallet when updated
  React.useEffect(() => {
    if (wallet) {
      localStorage.setItem('wallet', JSON.stringify(wallet));
    }
  }, [wallet]);

  const clear = () => {
    setWallet(null);
    setError(null);
    setStage('idle');
    localStorage.removeItem('wallet');
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
      setStage('submitting');

      const resultPromise = authProvider.login(credentials as any, (optimisticWallet: Wallet) => {
        // Called as soon as blob/proofs are sent
        setWallet(optimisticWallet);
        setStage('blobSent');
        setIsLoading(false);
      });

      const result = await resultPromise;

      if (result.success && result.wallet) {
        // Settlement achieved
        setWallet(result.wallet);
        setStage('settled');
      } else {
        setStage('error');
        setError(result.error ?? 'Login failed');
        setWallet(null);
      }
    } catch (e) {
      setStage('error');
      setError(e instanceof Error ? e.message : 'Login failed');
      setWallet(null);
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
      setStage('submitting');

      const resultPromise = authProvider.register(credentials as any, (optimisticWallet: Wallet) => {
        setWallet(optimisticWallet);
        setStage('blobSent');
        setIsLoading(false);
      });

      const result = await resultPromise;

      if (result.success && result.wallet) {
        setWallet(result.wallet);
        setStage('settled');
      } else {
        setStage('error');
        setError(result.error ?? 'Registration failed');
        setWallet(null);
      }
    } catch (e) {
      setStage('error');
      setError(e instanceof Error ? e.message : 'Registration failed');
      setWallet(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    clear();
  }, []);

  return (
    <WalletContext.Provider value={{ wallet, isLoading, error, stage, login, register, logout }}>
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