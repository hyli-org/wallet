import { Wallet } from "./wallet";

export interface AuthCredentials {
    type: string;
    [key: string]: any;
}

export interface AuthProvider {
    type: string;
    authenticate(): Promise<Wallet>;
    verify(credentials: AuthCredentials): Promise<boolean>;
    disconnect(): void;
}
