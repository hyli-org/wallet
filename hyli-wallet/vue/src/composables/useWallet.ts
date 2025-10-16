import {
    getStoredWallet,
    storeWallet,
    type Wallet,
    type WalletEventCallback,
    type WalletErrorCallback,
    type AuthProviderManagerConfig,
} from "hyli-wallet";
import type { AuthCredentials, AuthResult } from "hyli-wallet";
import { authProviderManager } from "hyli-wallet";
import { WalletOperations } from "hyli-wallet";
import { type Blob } from "hyli";
import { ConfigService } from "hyli-wallet";
import { NodeService } from "hyli-wallet";
import { IndexerService } from "hyli-wallet";
import { sessionKeyService } from "hyli-wallet";
import { computed, ref, watchEffect } from "vue";

export type ProviderOption = "password" | "google" | "metamask" | "github" | "x";

export interface WalletProviderProps {
    config: {
        nodeBaseUrl: string;
        walletServerBaseUrl: string;
        applicationWsUrl: string;
        providers: AuthProviderManagerConfig;
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

// Wallet is globally shared so all calls to useWallet() get the same instance
const wallet = ref<Wallet | null>(null);
wallet.value = getStoredWallet();
watchEffect(() => {
    if (wallet.value) storeWallet(wallet.value);
});

const walletConfig = ref<WalletProviderProps>({
    config: {
        // Defaults from Hylix for convenience
        nodeBaseUrl: "http://localhost:4321",
        walletServerBaseUrl: "http://localhost:4000",
        applicationWsUrl: "ws://localhost:8081",
        providers: {
            password: { enabled: true },
        },
    },
    sessionKeyConfig: { duration: 72 * 60 * 60 * 1000 },
    forceSessionKey: undefined,
    onWalletEvent: undefined,
    onError: undefined,
});

export const setWalletConfig = (config: WalletProviderProps) => {
    walletConfig.value = config;
};

export const useWalletInternal = () => {
    // We are passing a reactive props object, so can't destructure here, add computed stuff
    const config = computed(() => walletConfig.value.config);
    const sessionKeyConfig = computed(() => walletConfig.value.sessionKeyConfig);
    const forceSessionKey = computed(() => walletConfig.value.forceSessionKey);
    const onWalletEvent = computed(() => walletConfig.value.onWalletEvent);
    const onError = computed(() => walletConfig.value.onError);

    // TODO: logic is somewhat identical to react
    const checkWalletExists = async () => {
        const lastCheck = localStorage.getItem("last_wallet_check");
        if (!lastCheck || Date.now() > +lastCheck + 5 * 60 * 1000) {
            // Update last check time
            localStorage.setItem("last_wallet_check", Date.now().toFixed(0));
            if (!wallet.value) return;
            // Check if the account exists
            try {
                const exists = await WalletOperations.checkAccountExists(wallet.value, true);
                if (!exists) {
                    console.warn("Account", wallet.value, "does not exist, clearing wallet.");
                    // If the account does not exist, we clear the wallet
                    wallet.value = null;
                    localStorage.removeItem("wallet");
                }
            } catch (error) {
                console.warn("Error checking account existence:", error);
            }
        }
    };

    // Initialize config and services on mount
    watchEffect(() => {
        ConfigService.initialize(config.value);
        NodeService.initialize(config.value.nodeBaseUrl);
        IndexerService.initialize(config.value.walletServerBaseUrl);
        authProviderManager.registerDefaultProviders(config.value.providers);
    });

    checkWalletExists();

    const defaultSessionKeyConfig: { duration: number; whitelist?: string[] } = { duration: 72 * 60 * 60 * 1000 };
    const effectiveSessionKeyConfig = computed(() => sessionKeyConfig.value ?? defaultSessionKeyConfig);

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
                duration: effectiveSessionKeyConfig.value.duration,
                whitelist: effectiveSessionKeyConfig.value.whitelist,
            };
        } else if (registerSessionKey) {
            return {
                duration: registerSessionKey.duration ?? effectiveSessionKeyConfig.value.duration,
                whitelist: registerSessionKey.whitelist ?? effectiveSessionKeyConfig.value.whitelist,
            };
        }
        return undefined;
    };

    const login = async (
        provider: ProviderOption,
        credentials: AuthCredentials,
        onWalletEvent?: WalletEventCallback,
        onError?: WalletErrorCallback,
        extraParams?: LoginExtras
    ): Promise<Wallet | undefined> => {
        const authProvider = authProviderManager.getProvider(provider);
        if (!authProvider) {
            const error = new Error(`Provider ${provider} not found`);
            (onError ?? internalOnError.value)?.(error);
            throw error;
        }
        let result = await authProvider.login({
            credentials,
            onWalletEvent: onWalletEvent ?? internalOnWalletEvent.value,
            onError: onError ?? internalOnError.value,
            registerSessionKey: getRegSessKey(extraParams?.registerSessionKey),
        });
        wallet.value = result.wallet ?? null;
        if (!result.success) {
            const error = new Error(result.error || "Login failed");
            (onError ?? internalOnError.value)?.(error);
            return undefined;
        }
        if (result.wallet)
            (onWalletEvent ?? internalOnWalletEvent.value)?.({
                account: result.wallet.address,
                type: "logged_in",
                message: `Logged in.`,
            });
        return result.wallet;
    };

    const registerAccount = async (
        provider: ProviderOption,
        credentials: AuthCredentials & { inviteCode: string },
        onWalletEvent?: WalletEventCallback,
        onError?: WalletErrorCallback,
        extraParams?: RegisterAccountExtras
    ): Promise<Wallet | undefined> => {
        const authProvider = authProviderManager.getProvider(provider);
        if (!authProvider) {
            const error = new Error(`Provider ${provider} not found`);
            (onError ?? internalOnError.value)?.(error);
            throw error;
        }
        let result: AuthResult;
        try {
            result = await authProvider.register({
                credentials,
                onWalletEvent: onWalletEvent ?? internalOnWalletEvent.value,
                onError: onError ?? internalOnError.value,
                registerSessionKey: getRegSessKey(extraParams?.registerSessionKey),
            });
        } catch (error) {
            (onError ?? internalOnError.value)?.(error as Error);
            result = {
                success: false,
                error: "Unknown error",
            };
        }
        if (!result.success) {
            const error = new Error(result.error || "Registration failed");
            (onError ?? internalOnError.value)?.(error);
            return undefined;
        }
        wallet.value = result.wallet ?? null;
        if (result.wallet)
            (onWalletEvent ?? internalOnWalletEvent.value)?.({
                account: result.wallet.address,
                type: "logged_in",
                message: `Logged in.`,
            });
        return result.wallet;
    };

    const logout = () => {
        localStorage.removeItem("wallet");
        wallet.value = null;
    };

    const registerSessionKey = async (
        password: string,
        expiration?: number,
        whitelist?: string[],
        laneId?: string,
        onWalletEventOverride?: WalletEventCallback,
        onErrorOverride?: WalletErrorCallback
    ) => {
        if (!wallet.value) {
            throw new Error("No wallet available");
        }
        const exp = expiration ?? Date.now() + effectiveSessionKeyConfig.value.duration;
        const wl = whitelist ?? effectiveSessionKeyConfig.value.whitelist;
        const finalOnWalletEvent = onWalletEventOverride ?? onWalletEvent.value;
        const finalOnError = onErrorOverride ?? onError.value;
        const result = await WalletOperations.registerSessionKey(
            wallet.value,
            password,
            exp,
            wl,
            laneId,
            finalOnWalletEvent,
            finalOnError
        );
        wallet.value = result.updatedWallet;
        return {
            sessionKey: result.sessionKey,
            txHashes: result.txHashes,
        };
    };

    const removeSessionKey = async (
        password: string,
        publicKey: string,
        onWalletEvent?: WalletEventCallback,
        onError?: WalletErrorCallback
    ) => {
        if (!wallet.value) {
            throw new Error("No wallet available");
        }

        const result = await WalletOperations.removeSessionKey(
            wallet.value,
            password,
            publicKey,
            onWalletEvent,
            onError
        );
        wallet.value = result.updatedWallet;

        return { txHashes: result.txHashes };
    };

    const cleanExpiredSessionKey = () => {
        if (!wallet.value) return;

        try {
            const updatedWallet = WalletOperations.cleanExpiredSessionKeys(wallet.value);
            wallet.value = updatedWallet;
        } catch (e) {
            // Silent fail, as this is a cleanup operation
        }
    };

    const createIdentityBlobs = (): [Blob, Blob] => {
        if (!wallet.value) {
            throw new Error("No wallet available");
        }
        return WalletOperations.createIdentityBlobs(wallet.value);
    };

    const getOrReuseSessionKey = async (checkBackend: boolean = false) => {
        if (!wallet.value) {
            return undefined;
        }
        return await WalletOperations.getOrReuseSessionKey(wallet.value, checkBackend);
    };

    const signMessageWithSessionKey = (message: string) => {
        if (!wallet.value || !wallet.value.sessionKey) {
            throw new Error("No session key available");
        }
        const [hash, signature] = sessionKeyService.signMessage(message, wallet.value.sessionKey.privateKey);
        return { hash, signature };
    };

    return {
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
        sessionKeyConfig: effectiveSessionKeyConfig,
        onWalletEvent,
        onError,
        forceSessionKey, // Pass forceSessionKey to internal context
    };
};

export const useWallet = () => {
    const context = useWalletInternal();
    return {
        wallet: context.wallet,
        login: context.login,
        registerAccount: context.registerAccount,
        getOrReuseSessionKey: context.getOrReuseSessionKey,
        registerSessionKey: context.registerSessionKey,
        removeSessionKey: context.removeSessionKey,
        cleanExpiredSessionKey: context.cleanExpiredSessionKey,
        createIdentityBlobs: context.createIdentityBlobs,
        signMessageWithSessionKey: context.signMessageWithSessionKey,
        logout: context.logout,
    };
};
