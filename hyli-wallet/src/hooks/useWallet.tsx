// useWallet hook and WalletProvider implementation
import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { storeWallet, type Wallet, type SessionKey, type TransactionCallback } from '../types/wallet';
import type { AuthCredentials } from '../providers/BaseAuthProvider';
import { authProviderManager } from '../providers/AuthProviderManager';
import { AuthStage } from '../types/login';
import * as WalletOperations from '../services/WalletOperations';
import { Blob } from 'hyli';
import { ConfigService } from '../services/ConfigService';
import { NodeService } from '../services/NodeService';

export type ProviderOption = 'password' | 'google' | 'github' | 'x';

interface WalletContextType {
  wallet: Wallet | null;
  isLoading: boolean;
  error: string | null;
  stage: AuthStage;
  login: (provider: ProviderOption, credentials: AuthCredentials) => Promise<void>;
  registerAccount: (provider: ProviderOption, credentials: AuthCredentials) => Promise<void>;
  registerSessionKey: (
    password: string,
    expiration: number,
    whitelist: string[],
    onTransaction?: TransactionCallback
  ) => Promise<{ sessionKey: SessionKey; txHashes: [string, string] }>;
  removeSessionKey: (
    password: string,
    publicKey: string,
    onTransaction?: TransactionCallback
  ) => Promise<{ txHashes: [string, string] }>;
  cleanExpiredSessionKey: () => void;
  createIdentityBlobs: () => [Blob, Blob];
  logout: () => void;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

interface WalletProviderProps {
  children: React.ReactNode;
  config: {
    nodeBaseUrl: string;
    walletServerBaseUrl: string;
    applicationWsUrl: string;
  };
}

export const WalletProvider: React.FC<WalletProviderProps> = ({ children, config }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(() => {
    const storedWallet = localStorage.getItem('wallet');
    return storedWallet ? JSON.parse(storedWallet) : null;
  });
  const [stage, setStage] = useState<AuthStage>('idle');

  // Initialize config and services on mount
  useEffect(() => {
    const initConfig = async () => {
      try {
        ConfigService.initialize(config);
        NodeService.initialize(config.nodeBaseUrl);
        setIsLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load configuration');
        setIsLoading(false);
      }
    };

    initConfig();
  }, [config]);

  // Block wallet operations if config isn't loaded
  const isWalletReady = !isLoading && !error;

  // Persist wallet when updated
  useEffect(() => {
    if (wallet) {
      storeWallet(wallet);
    }
  }, [wallet]);

  const login = useCallback(async (provider: ProviderOption, credentials: AuthCredentials) => {
    if (!isWalletReady) {
      setError('Wallet configuration is not ready');
      return;
    }
    const authProvider = authProviderManager.getProvider(provider);
    if (!authProvider) {
      setError(`Provider ${provider} not found`);
      return;
    }
    try {
      setIsLoading(true);
      setError(null);
      setStage('submitting');

      const resultPromise = authProvider.login(credentials as any, {
        onTransaction: (txHash: string, type: string) => {
          if (type === 'blob') {
            setStage('blobSent');
          }
        }
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
  }, [isWalletReady]);

  const registerAccount = useCallback(async (provider: ProviderOption, credentials: AuthCredentials) => {
    if (!isWalletReady) {
      setError('Wallet configuration is not ready');
      return;
    }
    const authProvider = authProviderManager.getProvider(provider);
    if (!authProvider) {
      setError(`Provider ${provider} not found`);
      return;
    }
    try {
      setIsLoading(true);
      setError(null);
      setStage('submitting');

      const resultPromise = authProvider.register(credentials as any, {
        onTransaction: (txHash: string, type: string) => {
          if (type === 'blob') {
            setStage('blobSent');
          }
        }
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
  }, [isWalletReady]);

  const logout = useCallback(() => {
    localStorage.removeItem('wallet');
    setWallet(null);
    setError(null);
    setStage('idle');
  }, []);

  // Add wallet operations
  const registerSessionKey = useCallback(async (
    password: string,
    expiration: number,
    whitelist: string[],
    onTransaction?: TransactionCallback
  ) => {
    if (!wallet) {
      setError('No wallet available');
      throw new Error('No wallet available');
    }

    try {
      setIsLoading(true);
      setError(null);
      setStage('submitting');

      const result = await WalletOperations.registerSessionKey(
        wallet,
        password,
        expiration,
        whitelist,
        (txHash: string, type: string) => {
          onTransaction?.(txHash, type);
          if (type === 'blob') {
            setStage('blobSent');
          }
        }
      );

      // Mise à jour du wallet après la confirmation blockchain
      setWallet(result.updatedWallet);
      setStage('settled');
      return {
        sessionKey: result.sessionKey,
        txHashes: result.txHashes
      };
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to register session key');
      setStage('error');
      throw e;
    } finally {
      setIsLoading(false);
    }
  }, [wallet]);

  const removeSessionKey = useCallback(async (
    password: string,
    publicKey: string,
    onTransaction?: TransactionCallback
  ) => {
    if (!wallet) {
      setError('No wallet available');
      throw new Error('No wallet available');
    }

    try {
      setIsLoading(true);
      setError(null);
      setStage('submitting');

      const result = await WalletOperations.removeSessionKey(
        wallet,
        password,
        publicKey,
        (txHash: string, type: string) => {
          onTransaction?.(txHash, type);
          if (type === 'blob') {
            setStage('blobSent');
          }
        }
      );

      // Mise à jour du wallet après la confirmation blockchain
      setWallet(result.updatedWallet);
      setStage('settled');
      return { txHashes: result.txHashes };
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove session key');
      setStage('error');
      throw e;
    } finally {
      setIsLoading(false);
    }
  }, [wallet]);

  const cleanExpiredSessionKey = useCallback(() => {
    if (!wallet) return;

    try {
      const updatedWallet = WalletOperations.cleanExpiredSessionKeys(wallet);
      setWallet(updatedWallet);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to clean expired session keys');
    }
  }, [wallet]);

  const createIdentityBlobs = useCallback((): [Blob, Blob] => {
    if (!wallet) {
      throw new Error('No wallet available');
    }

    try {
      return WalletOperations.createIdentityBlobs(wallet);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create identity blobs');
      throw e;
    }
  }, [wallet]);

  return (
    <WalletContext.Provider
      value={{
        wallet,
        isLoading,
        error,
        stage,
        login,
        registerAccount,
        registerSessionKey,
        removeSessionKey,
        createIdentityBlobs,
        cleanExpiredSessionKey,
        logout
      }}
    >
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
