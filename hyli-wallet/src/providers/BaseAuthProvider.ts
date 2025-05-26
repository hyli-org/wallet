import { Wallet, WalletErrorCallback, WalletEventCallback } from "../types/wallet";

export interface AuthCredentials {
    username: string;
    [key: string]: any;
}

export interface AuthEvents {
    onTransaction?: (txHash: string, type: string) => void;
}

export interface AuthResult {
    success: boolean;
    wallet?: Wallet;
    error?: string;
}

export interface LoginParams {
    credentials: AuthCredentials;
    onWalletEvent?: WalletEventCallback;
    onError?: WalletErrorCallback;
    registerSessionKey?: {
        duration: number; // ms
        whitelist: string[];
    };
}
export interface RegisterAccountParams {
    credentials: AuthCredentials;
    onWalletEvent?: WalletEventCallback;
    onError?: WalletErrorCallback;
    registerSessionKey?: {
        duration: number; // ms
        whitelist: string[];
    };
}

export interface AuthProvider {
    type: string;
    login(params: LoginParams): Promise<AuthResult>;
    register(params: RegisterAccountParams): Promise<AuthResult>;
    isEnabled(): boolean;
}
