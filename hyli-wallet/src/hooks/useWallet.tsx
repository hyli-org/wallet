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
        onError?: WalletErrorCallback,
        extraParams?: LoginExtras
    ) => Promise<Wallet | undefined>;
    registerAccount: (
        provider: ProviderOption,
        credentials: AuthCredentials & { inviteCode: string },
        onWalletEvent?: WalletEventCallback,
        onError?: WalletErrorCallback,
        extraParams?: RegisterAccountExtras
    ) => Promise<Wallet | undefined>;
    getOrReuseSessionKey: (checkBackend?: boolean) => Promise<SessionKey | undefined>;
    registerSessionKey: (
        password: string,
        expiration?: number,
        whitelist?: string[],
        laneId?: string,
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
        whitelist?: string[];
    };
    onWalletEvent?: WalletEventCallback;
    onError?: WalletErrorCallback;
    forceSessionKey?: boolean;
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
        whitelist?: string[];
    };
    /**
     * Controls session key checkbox behavior in AuthForm:
     *  - true: force session key ON (checked, cannot change)
     *  - false: force session key OFF (do not show checkbox)
     *  - undefined: allow user to toggle checkbox
     */
    forceSessionKey?: boolean;
    onWalletEvent?: WalletEventCallback;
    onError?: WalletErrorCallback;
}

export interface LoginExtras {
    registerSessionKey?:
        | boolean
        | {
              duration?: number; // ms
              whitelist?: string[];
          };
}
export interface RegisterAccountExtras {
    registerSessionKey?:
        | boolean
        | {
              duration?: number; // ms
              whitelist?: string[];
          };
}

export const WalletProvider: React.FC<React.PropsWithChildren<WalletProviderProps>> = ({
    children,
    config,
    sessionKeyConfig,
    forceSessionKey,
    onWalletEvent,
    onError,
}) => {
    const [wallet, setWallet] = useState<Wallet | null>(() => {
        const storedWallet = localStorage.getItem("wallet");
        return storedWallet ? JSON.parse(storedWallet) : null;
    });

    // Persist wallet when updated
    useEffect(() => {
        if (wallet) {
            storeWallet(wallet);
        }
    }, [wallet]);

    const checkWalletExists = () => {
        if (wallet) {
            const lastCheck = localStorage.getItem("last_wallet_check");
            if (!lastCheck || Date.now() > +lastCheck + 5 * 60 * 1000) {
                // Update last check time
                localStorage.setItem("last_wallet_check", Date.now().toFixed(0));
                // Check if the account exists
                WalletOperations.checkAccountExists(wallet, true)
                    .then((exists) => {
                        if (!exists) {
                            console.warn("Account", wallet, "does not exist, clearing wallet.");
                            // If the account does not exist, we clear the wallet
                            setWallet(null);
                            localStorage.removeItem("wallet");
                        }
                    })
                    .catch((error) => {
                        console.warn("Error checking account existence:", error);
                    });
            }
        }
    };

    // Initialize config and services on mount
    useEffect(() => {
        const initConfig = async () => {
            ConfigService.initialize(config);
            NodeService.initialize(config.nodeBaseUrl);
            IndexerService.initialize(config.walletServerBaseUrl);
            checkWalletExists();
        };

        initConfig();
    }, [config]);

    const defaultSessionKeyConfig: { duration: number; whitelist?: string[] } = { duration: 72 * 60 * 60 * 1000 };
    const effectiveSessionKeyConfig = sessionKeyConfig ?? defaultSessionKeyConfig;

    const internalOnWalletEvent = onWalletEvent;
    const internalOnError = onError;

    const getRegSessKey = (
        registerSessionKey: boolean | { duration?: number; whitelist?: string[] } | undefined
    ):
        | undefined
        | {
              duration: number;
              whitelist?: string[];
          } => {
        if (registerSessionKey === true) {
            return {
                duration: effectiveSessionKeyConfig.duration,
                whitelist: effectiveSessionKeyConfig.whitelist,
            };
        } else if (registerSessionKey) {
            return {
                duration: registerSessionKey.duration ?? effectiveSessionKeyConfig.duration,
                whitelist: registerSessionKey.whitelist ?? effectiveSessionKeyConfig.whitelist,
            };
        }
        return undefined;
    };

    const login = useCallback(
        async (
            provider: ProviderOption,
            credentials: AuthCredentials,
            onWalletEvent?: WalletEventCallback,
            onError?: WalletErrorCallback,
            extraParams?: LoginExtras
        ): Promise<Wallet | undefined> => {
            const authProvider = authProviderManager.getProvider(provider);
            if (!authProvider) {
                const error = new Error(`Provider ${provider} not found`);
                (onError ?? internalOnError)?.(error);
                throw error;
            }
            let result = await authProvider.login({
                credentials,
                onWalletEvent: onWalletEvent ?? internalOnWalletEvent,
                onError: onError ?? internalOnError,
                registerSessionKey: getRegSessKey(extraParams?.registerSessionKey),
            });
            setWallet(result.wallet ?? null);
            if (result.wallet)
                (onWalletEvent ?? internalOnWalletEvent)?.({
                    account: result.wallet.address,
                    type: "logged_in",
                    message: `Logged in.`,
                });
            return result.wallet;
        },
        [wallet, internalOnWalletEvent, internalOnError, sessionKeyConfig]
    );

    const registerAccount = useCallback(
        async (
            provider: ProviderOption,
            credentials: AuthCredentials & { inviteCode: string },
            onWalletEvent?: WalletEventCallback,
            onError?: WalletErrorCallback,
            extraParams?: RegisterAccountExtras
        ): Promise<Wallet | undefined> => {
            const authProvider = authProviderManager.getProvider(provider);
            if (!authProvider) {
                const error = new Error(`Provider ${provider} not found`);
                (onError ?? internalOnError)?.(error);
                throw error;
            }
            let result: AuthResult;
            try {
                result = await authProvider.register({
                    credentials,
                    onWalletEvent: onWalletEvent ?? internalOnWalletEvent,
                    onError: onError ?? internalOnError,
                    registerSessionKey: getRegSessKey(extraParams?.registerSessionKey),
                });
            } catch (error) {
                (onError ?? internalOnError)?.(error as Error);
                result = {
                    success: false,
                    error: "Unknown error",
                };
            }
            if (!result.success) {
                const error = new Error(result.error || "Registration failed");
                (onError ?? internalOnError)?.(error);
                return undefined;
            }
            setWallet(result.wallet ?? null);
            if (result.wallet)
                (onWalletEvent ?? internalOnWalletEvent)?.({
                    account: result.wallet.address,
                    type: "logged_in",
                    message: `Logged in.`,
                });
            return result.wallet;
        },
        [wallet, internalOnWalletEvent, internalOnError, sessionKeyConfig]
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
            laneId?: string,
            onWalletEventOverride?: WalletEventCallback,
            onErrorOverride?: WalletErrorCallback
        ) => {
            if (!wallet) {
                throw new Error("No wallet available");
            }
            const exp = expiration ?? Date.now() + effectiveSessionKeyConfig.duration;
            const wl = whitelist ?? effectiveSessionKeyConfig.whitelist;
            const finalOnWalletEvent = onWalletEventOverride ?? onWalletEvent;
            const finalOnError = onErrorOverride ?? onError;
            const result = await WalletOperations.registerSessionKey(
                wallet,
                password,
                exp,
                wl,
                laneId,
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
        forceSessionKey, // Pass forceSessionKey to internal context
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
