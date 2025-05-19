import { AuthProvider, AuthCredentials, AuthResult } from "./BaseAuthProvider";
// import { Wallet } from '../types/wallet';

export interface GoogleAuthCredentials extends AuthCredentials {
    googleToken: string;
}

export class GoogleAuthProvider implements AuthProvider {
    type = "google";

    isEnabled(): boolean {
        return false;
    }

    async login(_credentials: GoogleAuthCredentials): Promise<AuthResult> {
        // À implémenter avec l'authentification Google
        throw new Error("Google authentication not implemented yet");
    }

    async register(_credentials: GoogleAuthCredentials): Promise<AuthResult> {
        // À implémenter avec l'authentification Google
        throw new Error("Google authentication not implemented yet");
    }
}
