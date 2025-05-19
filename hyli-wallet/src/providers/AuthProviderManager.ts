import { AuthProvider } from "./BaseAuthProvider";
import { PasswordAuthProvider } from "./PasswordAuthProvider";
import { GoogleAuthProvider } from "./GoogleAuthProvider";

export class AuthProviderManager {
    private providers: Map<string, AuthProvider>;

    constructor() {
        this.providers = new Map();
        this.registerDefaultProviders();
    }

    private registerDefaultProviders() {
        this.registerProvider(new PasswordAuthProvider());
        this.registerProvider(new GoogleAuthProvider());
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

export const authProviderManager = new AuthProviderManager();
