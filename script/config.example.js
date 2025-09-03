// Configuration template for the wallet registration script
// Copy this file to config.js and update the values

export const CONFIG = {
    // Hyli Node Service URL
    NODE_BASE_URL: process.env.NODE_BASE_URL || "http://localhost:4321",
    
    // Hyli Indexer Service URL  
    INDEXER_BASE_URL: process.env.INDEXER_BASE_URL || "http://localhost:8082",
    
    // Wallet Contract Name
    WALLET_CONTRACT_NAME: "wallet",
    
    // Default session key duration (24 hours in milliseconds)
    DEFAULT_SESSION_KEY_DURATION: 24 * 60 * 60 * 1000,
    
    // Default whitelist for session keys (empty array means no restrictions)
    DEFAULT_SESSION_KEY_WHITELIST: [],
    
    // Timeout for operations (in milliseconds)
    OPERATION_TIMEOUT: 60000,
    
    // Retry configuration
    RETRY_CONFIG: {
        maxRetries: 3,
        retryDelay: 1000, // 1 second
        backoffMultiplier: 2
    },
    
    // Logging configuration
    LOGGING: {
        level: "info", // debug, info, warn, error
        enableConsole: true,
        enableFile: false,
        logFile: "registration.log"
    }
};

// Environment-specific configurations
export const ENV_CONFIGS = {
    local: {
        NODE_BASE_URL: "http://localhost:4321",
        INDEXER_BASE_URL: "http://localhost:8082",
        LOGGING: { level: "debug" }
    },
    
    devnet: {
        NODE_BASE_URL: "https://node.devnet.hyli.org",
        INDEXER_BASE_URL: "https://indexer.devnet.hyli.org",
        LOGGING: { level: "info" }
    },
    
    testnet: {
        NODE_BASE_URL: "https://node.testnet.hyli.org",
        INDEXER_BASE_URL: "https://indexer.testnet.hyli.org",
        LOGGING: { level: "warn" }
    }
};

// Helper function to get configuration based on environment
export function getConfig(environment = process.env.NODE_ENV || "local") {
    const envConfig = ENV_CONFIGS[environment] || {};
    return { ...CONFIG, ...envConfig };
}

// Helper function to validate configuration
export function validateConfig(config) {
    const required = ['NODE_BASE_URL', 'INDEXER_BASE_URL', 'WALLET_CONTRACT_NAME'];
    const missing = required.filter(key => !config[key]);
    
    if (missing.length > 0) {
        throw new Error(`Missing required configuration: ${missing.join(', ')}`);
    }
    
    // Validate URLs
    try {
        new URL(config.NODE_BASE_URL);
        new URL(config.INDEXER_BASE_URL);
    } catch (error) {
        throw new Error(`Invalid URL in configuration: ${error.message}`);
    }
    
    return true;
}
