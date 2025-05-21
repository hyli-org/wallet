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

export interface AuthProvider {
    type: string;
    login(credentials: AuthCredentials, onWalletEvent?: WalletEventCallback, onError?: WalletErrorCallback): Promise<AuthResult>;
    register(credentials: AuthCredentials, onWalletEvent?: WalletEventCallback, onError?: WalletErrorCallback): Promise<AuthResult>;
    isEnabled(): boolean;
}
