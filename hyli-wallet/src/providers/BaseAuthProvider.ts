import { AuthCredentials, AuthResult } from "../types/auth";
import { Wallet, WalletErrorCallback, WalletEventCallback } from "../types/wallet";

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
