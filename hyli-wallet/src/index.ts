export { HyliWallet } from "./components/HyliWallet";
export { GoogleAuthProvider, type GoogleAuthCredentials } from "./providers/GoogleAuthProvider";
export { EthereumWalletAuthProvider, type EthereumWalletAuthCredentials } from "./providers/EthereumWalletAuthProvider";
export { PasswordAuthProvider, type PasswordAuthCredentials } from "./providers/PasswordAuthProvider";
export type { AuthProvider } from "./providers/BaseAuthProvider";
export {
    authProviderManager,
    AuthProviderManager,
    type AuthProviderManagerConfig,
} from "./providers/AuthProviderManager";
export type { AuthCredentials, AuthResult } from "./types/auth";
export type * from "./types/wallet";
export { getStoredWallet, storeWallet, walletContractName } from "./types/wallet";
export { ConfigService, type WalletConfig } from "./services/ConfigService";
export {
    registerBlob as register,
    verifyIdentityBlob as verifyIdentity,
    addSessionKeyBlob as addSessionKey,
    removeSessionKeyBlob as removeSessionKey,
    serializeSecp256k1Blob,
    serializeIdentityAction,
    deserializeIdentityAction,
} from "./types/wallet";
export type {
    ProviderOption,
    WalletContextType,
    WalletProviderProps,
} from "./hooks/useWallet";
export { WalletProvider, useWallet } from "./hooks/useWallet";
export type { EthereumProviderRequest } from "./types/ethereum";
export { sessionKeyService } from "./services/SessionKeyService";
export type { BackendSessionKey, AccountInfo } from "./services/IndexerService";
export { IndexerService } from "./services/IndexerService";
export { NodeService } from "./services/NodeService";
export {
    initializeEthereumProviders,
    getEthereumProviders,
    subscribeToEthereumProviders,
    findEthereumProviderByUuid,
    findEthereumProviderByWalletId,
} from "./providers/ethereumProviders";
export { getAuthErrorMessage } from "./utils/errorMessages";
export * as WalletOperations from "./services/WalletOperations";
