export interface AppConfig {
    nodeBaseUrl: string;
    walletServerBaseUrl: string;
    applicationWsUrl: string;
    indexerBaseUrl: string;
    txExplorerUrl: string;
    faucetUrl: string;
    googleClientId?: string;
}

export class ConfigService {
    private static config: AppConfig | null = null;

    static getConfig(): AppConfig {
        if (!this.config) {
            // Récupérer depuis window.__ENV__ (variables d'environnement au runtime)
            const runtimeConfig = (window as any).__ENV__;

            // Helper function to validate URL
            const isValidUrl = (url: string | undefined): boolean => {
                if (!url) return false;
                try {
                    new URL(url);
                    return true;
                } catch {
                    return false;
                }
            };

            const stripTrailingSlash = (url: string): string => url.replace(/\/+$/, "");

            this.config = {
                nodeBaseUrl: isValidUrl(runtimeConfig?.NODE_BASE_URL)
                    ? runtimeConfig.NODE_BASE_URL
                    : import.meta.env.VITE_NODE_BASE_URL || "http://localhost:8080",
                walletServerBaseUrl: isValidUrl(runtimeConfig?.WALLET_SERVER_BASE_URL)
                    ? runtimeConfig.WALLET_SERVER_BASE_URL
                    : import.meta.env.VITE_WALLET_SERVER_BASE_URL || "http://localhost:3000",
                applicationWsUrl: isValidUrl(runtimeConfig?.WALLET_WS_URL)
                    ? runtimeConfig.WALLET_WS_URL
                    : import.meta.env.VITE_WALLET_WS_URL || "ws://localhost:3000",
                indexerBaseUrl: isValidUrl(runtimeConfig?.INDEXER_BASE_URL)
                    ? runtimeConfig.INDEXER_BASE_URL
                    : import.meta.env.VITE_INDEXER_BASE_URL || "http://localhost:4321",
                txExplorerUrl: stripTrailingSlash(
                    (isValidUrl(runtimeConfig?.TX_EXPLORER_URL)
                        ? runtimeConfig.TX_EXPLORER_URL
                        : import.meta.env.VITE_TX_EXPLORER_URL) || "http://localhost:8080",
                ),
                faucetUrl: isValidUrl(runtimeConfig?.FAUCET_URL)
                    ? runtimeConfig.FAUCET_URL
                    : import.meta.env.VITE_FAUCET_URL || "http://localhost:8080",
                googleClientId: runtimeConfig?.GOOGLE_CLIENT_ID || import.meta.env.VITE_GOOGLE_CLIENT_ID,
            };
        }
        return this.config;
    }

    static getNodeBaseUrl(): string {
        return this.getConfig().nodeBaseUrl;
    }

    static getWalletServerBaseUrl(): string {
        return this.getConfig().walletServerBaseUrl;
    }

    static getApplicationWsUrl(): string {
        return this.getConfig().applicationWsUrl;
    }

    static getIndexerBaseUrl(): string {
        return this.getConfig().indexerBaseUrl;
    }

    static getTxExplorerUrl(): string {
        return this.getConfig().txExplorerUrl;
    }

    static getFaucetUrl(): string {
        return this.getConfig().faucetUrl;
    }

    static getGoogleClientId(): string | undefined {
        return this.getConfig().googleClientId;
    }
}
