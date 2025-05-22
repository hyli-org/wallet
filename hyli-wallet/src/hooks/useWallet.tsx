// useWallet hook and WalletProvider implementation
import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import {
    storeWallet,
    type Wallet,
    type SessionKey,
    type TransactionCallback,
    WalletEventCallback,
    WalletErrorCallback,
} from "../types/wallet";
import type { AuthCredentials, AuthResult } from "../providers/BaseAuthProvider";
import { authProviderManager } from "../providers/AuthProviderManager";
import * as WalletOperations from "../services/WalletOperations";
import { Blob } from "hyli";
import { ConfigService } from "../services/ConfigService";
import { NodeService } from "../services/NodeService";
import { IndexerService } from "../services/IndexerService";
import { sessionKeyService } from "../services/SessionKeyService";

export type ProviderOption = "password" | "google" | "github" | "x";

export interface WalletContextType {
    wallet: Wallet | null;
    login: (
        provider: ProviderOption,
        credentials: AuthCredentials,
        onWalletEvent?: WalletEventCallback,
        onError?: WalletErrorCallback
    ) => Promise<void>;
    registerAccount: (
        provider: ProviderOption,
        credentials: AuthCredentials,
        onWalletEvent?: WalletEventCallback,
        onError?: WalletErrorCallback
    ) => Promise<void>;
    getOrReuseSessionKey: (checkBackend?: boolean) => Promise<SessionKey | undefined>;
    registerSessionKey: (
        password: string,
        expiration?: number,
        whitelist?: string[],
        onWalletEvent?: WalletEventCallback,
        onError?: WalletErrorCallback
    ) => Promise<{ sessionKey: SessionKey; txHashes: [string, string] }>;
    removeSessionKey: (
        password: string,
        publicKey: string,
        onWalletEvent?: WalletEventCallback,
        onError?: WalletErrorCallback
    ) => Promise<{ txHashes: [string, string] }>;
    cleanExpiredSessionKey: () => void;
    createIdentityBlobs: () => [Blob, Blob];
    signMessageWithSessionKey: (message: string) => { hash: Uint8Array; signature: Uint8Array };
    logout: () => void;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

interface WalletInternalType extends WalletContextType {
    sessionKeyConfig?: {
        duration: number;
        whitelist: string[];
    };
    onWalletEvent?: WalletEventCallback;
    onError?: WalletErrorCallback;
}
const WalletInternalContext = createContext<WalletInternalType | undefined>(undefined);

export interface WalletProviderProps {
    config: {
        nodeBaseUrl: string;
        walletServerBaseUrl: string;
        applicationWsUrl: string;
    };
    sessionKeyConfig?: {
        duration: number; // ms
        whitelist: string[];
    };
    onWalletEvent?: WalletEventCallback;
    onError?: WalletErrorCallback;
}

export const WalletProvider: React.FC<React.PropsWithChildren<WalletProviderProps>> = ({
    children,
    config,
    sessionKeyConfig,
    onWalletEvent,
    onError,
}) => {
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

    const defaultSessionKeyConfig = { duration: 72 * 60 * 60 * 1000, whitelist: [] };
    const effectiveSessionKeyConfig = sessionKeyConfig ?? defaultSessionKeyConfig;

    const internalOnWalletEvent = onWalletEvent;
    const internalOnError = onError;

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
                (onError ?? internalOnError)?.(error);
                throw error;
            }
            let result = await authProvider.login(
                credentials as any,
                onWalletEvent ?? internalOnWalletEvent,
                onError ?? internalOnError
            );
            setWallet(result.wallet ?? null);
        },
        [wallet, internalOnWalletEvent, internalOnError]
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
                (onError ?? internalOnError)?.(error);
                throw error;
            }
            let result = await authProvider.register(
                credentials as any,
                onWalletEvent ?? internalOnWalletEvent,
                onError ?? internalOnError
            );
            setWallet(result.wallet ?? null);
        },
        [wallet, internalOnWalletEvent, internalOnError]
    );

    const logout = useCallback(() => {
        localStorage.removeItem("wallet");
        setWallet(null);
    }, []);

    const registerSessionKey = useCallback(
        async (
            password: string,
            expiration?: number,
            whitelist?: string[],
            onWalletEventOverride?: WalletEventCallback,
            onErrorOverride?: WalletErrorCallback,
            configOverride?: { duration?: number; whitelist?: string[] }
        ) => {
            if (!wallet) {
                throw new Error("No wallet available");
            }
            const finalConfig = {
                duration: configOverride?.duration ?? effectiveSessionKeyConfig.duration,
                whitelist: configOverride?.whitelist ?? effectiveSessionKeyConfig.whitelist,
            };
            const exp = expiration ?? Date.now() + finalConfig.duration;
            const wl = whitelist ?? finalConfig.whitelist;
            const finalOnWalletEvent = onWalletEventOverride ?? onWalletEvent;
            const finalOnError = onErrorOverride ?? onError;
            const result = await WalletOperations.registerSessionKey(
                wallet,
                password,
                exp,
                wl,
                finalOnWalletEvent,
                finalOnError
            );
            setWallet(result.updatedWallet);
            return {
                sessionKey: result.sessionKey,
                txHashes: result.txHashes,
            };
        },
        [wallet, effectiveSessionKeyConfig, onWalletEvent, onError]
    );

    const removeSessionKey = useCallback(
        async (
            password: string,
            publicKey: string,
            onWalletEvent?: WalletEventCallback,
            onError?: WalletErrorCallback
        ) => {
            if (!wallet) {
                throw new Error("No wallet available");
            }

            const result = await WalletOperations.removeSessionKey(wallet, password, publicKey, onWalletEvent, onError);

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

    const getOrReuseSessionKey = useCallback(
        async (checkBackend: boolean = false) => {
            if (!wallet) {
                return undefined;
            }
            return await WalletOperations.getOrReuseSessionKey(wallet, checkBackend);
        },
        [wallet]
    );

    const signMessageWithSessionKey = useCallback(
        (message: string) => {
            if (!wallet || !wallet.sessionKey) {
                throw new Error("No session key available");
            }
            const [hash, signature] = sessionKeyService.signMessage(message, wallet.sessionKey.privateKey);
            return { hash, signature };
        },
        [wallet]
    );

    // Public context value (no sessionKeyConfig)
    const publicValue: WalletContextType = {
        wallet,
        login,
        registerAccount,
        registerSessionKey,
        removeSessionKey,
        createIdentityBlobs,
        cleanExpiredSessionKey,
        getOrReuseSessionKey,
        signMessageWithSessionKey,
        logout,
    };
    // Private/internal context value (includes sessionKeyConfig)
    const internalValue: WalletInternalType = {
        ...publicValue,
        sessionKeyConfig: effectiveSessionKeyConfig,
        onWalletEvent,
        onError,
    };

    return (
        <WalletContext.Provider value={publicValue}>
            <WalletInternalContext.Provider value={internalValue}>{children}</WalletInternalContext.Provider>
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

export const useWalletInternal = (): WalletInternalType => {
    const ctx = useContext(WalletInternalContext);
    if (!ctx) {
        throw new Error("useWalletInternal must be used within a WalletProvider");
    }
    return ctx;
};
