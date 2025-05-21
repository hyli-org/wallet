// useWallet hook and WalletProvider implementation
import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { storeWallet, type Wallet, type SessionKey, type TransactionCallback, WalletEventCallback, WalletErrorCallback } from "../types/wallet";
import type { AuthCredentials, AuthResult } from "../providers/BaseAuthProvider";
import { authProviderManager } from "../providers/AuthProviderManager";
import * as WalletOperations from "../services/WalletOperations";
import { Blob } from "hyli";
import { ConfigService } from "../services/ConfigService";
import { NodeService } from "../services/NodeService";
import { IndexerService } from "../services/IndexerService";

export type ProviderOption = "password" | "google" | "github" | "x";


interface WalletContextType {
    wallet: Wallet | null;
    login: (
        provider: ProviderOption, 
        credentials: AuthCredentials,
        onWalletEvent?: WalletEventCallback,
        onError?: WalletErrorCallback,
    ) => Promise<void>;
    registerAccount: (
        provider: ProviderOption, 
        credentials: AuthCredentials,
        onWalletEvent?: WalletEventCallback,
        onError?: WalletErrorCallback,
    ) => Promise<void>;
    registerSessionKey: (
        password: string,
        expiration: number,
        whitelist: string[],
        onWalletEvent?: WalletEventCallback,
        onError?: WalletErrorCallback,
    ) => Promise<{ sessionKey: SessionKey; txHashes: [string, string] }>;
    removeSessionKey: (
        password: string,
        publicKey: string,
        onWalletEvent?: WalletEventCallback,
        onError?: WalletErrorCallback,
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
    const [wallet, setWallet] = useState<Wallet | null>(() => {
        const storedWallet = localStorage.getItem("wallet");
        return storedWallet ? JSON.parse(storedWallet) : null;
    });

    // Initialize config and services on mount
    useEffect(() => {
        const initConfig = async () => {
            ConfigService.initialize(config);
            NodeService.initialize(config.nodeBaseUrl);
            IndexerService.initialize(config.walletServerBaseUrl);
        };

        initConfig();
    }, [config]);

    // Persist wallet when updated
    useEffect(() => {
        if (wallet) {
            storeWallet(wallet);
        }
    }, [wallet]);

    const login = useCallback(
        async (
            provider: ProviderOption,
            credentials: AuthCredentials,
            onWalletEvent?: WalletEventCallback,
            onError?: WalletErrorCallback
        ): Promise<void> => {

            const authProvider = authProviderManager.getProvider(provider);
            if (!authProvider) {
                const error = new Error(`Provider ${provider} not found`);
                onError?.(error);
                throw error;
            }
            let result = await authProvider.login(credentials as any, onWalletEvent, onError);

            setWallet(result.wallet ?? null);
        },
        [wallet]
    );

    const registerAccount = useCallback(
        async (
            provider: ProviderOption,
            credentials: AuthCredentials,
            onWalletEvent?: WalletEventCallback,
            onError?: WalletErrorCallback
        ): Promise<void> => {

            const authProvider = authProviderManager.getProvider(provider);
            if (!authProvider) {
                const error = new Error(`Provider ${provider} not found`);
                onError?.(error);
                throw error;
            }
            let result = await authProvider.register(credentials as any, onWalletEvent, onError);

            setWallet(result.wallet ?? null);
        },
        [wallet]
    );

    const logout = useCallback(() => {
        localStorage.removeItem("wallet");
        setWallet(null);
    }, []);

    const registerSessionKey = useCallback(
        async (
            password: string, 
            expiration: number, 
            whitelist: string[],
            onWalletEvent?: WalletEventCallback,
            onError?: WalletErrorCallback,
        ) => {
            if (!wallet) {
                throw new Error("No wallet available");
            }

            const result = await WalletOperations.registerSessionKey(
                wallet,
                password,
                expiration,
                whitelist,
                onWalletEvent,
                onError,
            );

            setWallet(result.updatedWallet);
            return {
                sessionKey: result.sessionKey,
                txHashes: result.txHashes,
            };
        },
        [wallet]
    );

    const removeSessionKey = useCallback(
        async (
            password: string, 
            publicKey: string, 
            onWalletEvent?: WalletEventCallback,
            onError?: WalletErrorCallback,
        ) => {
            if (!wallet) {
                throw new Error("No wallet available");
            }

            const result = await WalletOperations.removeSessionKey(
                wallet,
                password,
                publicKey,
                onWalletEvent,
                onError,
            );

            setWallet(result.updatedWallet);
            return { txHashes: result.txHashes };
        },
        [wallet]
    );

    const cleanExpiredSessionKey = useCallback(() => {
        if (!wallet) return;

        try {
            const updatedWallet = WalletOperations.cleanExpiredSessionKeys(wallet);
            setWallet(updatedWallet);
        } catch (e) {
            // Silent fail, as this is a cleanup operation
        }
    }, [wallet]);

    const createIdentityBlobs = useCallback((): [Blob, Blob] => {
        if (!wallet) {
            throw new Error("No wallet available");
        }

        try {
            return WalletOperations.createIdentityBlobs(wallet);
        } catch (e) {
            throw e;
        }
    }, [wallet]);

    return (
        <WalletContext.Provider
            value={{
                wallet,
                login,
                registerAccount,
                registerSessionKey,
                removeSessionKey,
                createIdentityBlobs,
                cleanExpiredSessionKey,
                logout,
            }}
        >
            {children}
        </WalletContext.Provider>
    );
};

export const useWallet = (): WalletContextType => {
    const ctx = useContext(WalletContext);
    if (!ctx) {
        throw new Error("useWallet must be used within a WalletProvider");
    }
    return ctx;
};
