export interface WalletConfig {
    walletServerBaseUrl: string;
    applicationWsUrl: string;
    nodeBaseUrl: string;
}

export class ConfigService {
    private static instance: ConfigService;
    private config: WalletConfig;

    private constructor(config: WalletConfig) {
        this.config = config;
    }

    static initialize(config: WalletConfig): ConfigService {
        ConfigService.instance = new ConfigService(config);
        return ConfigService.instance;
    }

    static getInstance(): ConfigService {
        if (!ConfigService.instance) {
            throw new Error("ConfigService not yet initialized.");
        }
        return ConfigService.instance;
    }

    static getConfig(): WalletConfig {
        if (!ConfigService.instance) {
            throw new Error("ConfigService not yet initialized.");
        }
        return ConfigService.instance.config;
    }
}
