import { Wallet, WalletErrorCallback, WalletEventCallback } from "../types/wallet";

export interface AuthCredentials {
    username: string;
}

export interface AuthEvents {
    onTransaction?: (txHash: string, type: string) => void;
}

export interface AuthResult {
    success: boolean;
    wallet?: Wallet;
    error?: string;
}

export interface LoginParams<K extends AuthCredentials = AuthCredentials> {
    credentials: K;
    onWalletEvent?: WalletEventCallback;
    onError?: WalletErrorCallback;
    registerSessionKey?: {
        duration: number; // ms
        whitelist?: string[];
        laneId?: string;
    };
}
export interface RegisterAccountParams<K extends AuthCredentials = AuthCredentials> {
    credentials: K & { inviteCode: string };
    onWalletEvent?: WalletEventCallback;
    onError?: WalletErrorCallback;
    registerSessionKey?: {
        duration: number; // ms
        whitelist?: string[];
    };
}

export interface AuthProvider<K extends AuthCredentials = AuthCredentials> {
    type: string;
    login(params: LoginParams<K>): Promise<AuthResult>;
    register(params: RegisterAccountParams<K>): Promise<AuthResult>;
    isEnabled(): boolean;
}
