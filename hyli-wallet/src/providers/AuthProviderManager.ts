// AuthProviderManager.ts
import { AuthProvider } from "./BaseAuthProvider";
import { PasswordAuthProvider } from "./PasswordAuthProvider";
import { GoogleAuthProvider } from "./GoogleAuthProvider";

export type AuthProviderManagerConfig = {
    /** Active/désactive le provider password (par défaut: true) */
    password?: { enabled?: boolean };

    /** Config pour Google (obligatoire pour l’activer) */
    google?: {
        clientId: string;
    };
};

export class AuthProviderManager {
    private providers: Map<string, AuthProvider>;

    constructor(config?: AuthProviderManagerConfig) {
        this.providers = new Map();
        this.registerDefaultProviders(config);
    }

    registerDefaultProviders(config?: AuthProviderManagerConfig) {
        this.providers = new Map();
        // PasswordAuthProvider activé par défaut
        if (config?.password?.enabled !== false) {
            this.registerProvider(new PasswordAuthProvider());
        }

        // GoogleAuthProvider seulement si la config est complète
        if (config?.google?.clientId) {
            this.registerProvider(new GoogleAuthProvider(config.google.clientId));
        }
    }

    registerProvider(provider: AuthProvider) {
        this.providers.set(provider.type, provider);
    }

    getProvider(type: string): AuthProvider | undefined {
        return this.providers.get(type);
    }

    getAvailableProviders(): string[] {
        return Array.from(this.providers.keys()).filter((type) => this.providers.get(type)?.isEnabled() ?? false);
    }
}

// --- Exemple d’instanciation (à faire depuis ton bootstrap / DI) ---
// import { submitBlob, getNonce, resolveAccountAddress } from "../infra/hyli";
// const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
// export const authProviderManager = new AuthProviderManager({
//   password: { enabled: true },
//   google: {
//     clientId: GOOGLE_CLIENT_ID,
//     deps: { submitBlob, getNonce, resolveAccountAddress },
//   },
// });

// Si tu préfères garder une export direct sans config, laisse juste :
export const authProviderManager = new AuthProviderManager();
