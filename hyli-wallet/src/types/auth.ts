import { Wallet } from "./wallet";

export interface AuthCredentials {
    username: string;
    type: string;
    [key: string]: any;
}

export interface AuthProvider {
    type: string;
    authenticate(): Promise<Wallet>;
    verify(credentials: AuthCredentials): Promise<boolean>;
    disconnect(): void;
}

export interface AuthEvents {
    onTransaction?: (txHash: string, type: string) => void;
}

export interface AuthResult {
    success: boolean;
    wallet?: Wallet;
    error?: string;
}
