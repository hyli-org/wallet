export { HyliWallet } from "./components/HyliWallet";
export type { PasswordAuthProvider } from "./providers/PasswordAuthProvider";
export type { GoogleAuthProvider } from "./providers/GoogleAuthProvider";
export { authProviderManager, AuthProviderManager } from "./providers/AuthProviderManager";
export type { AuthProvider, AuthCredentials, AuthResult } from "./types/auth";
export type {
    AuthMethod,
    Wallet,
    WalletAction,
    WalletEventCallback,
    WalletErrorCallback,
    WalletEvent,
    LoginStage,
    RegistrationStage,
} from "./types/wallet";
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
export type { ProviderOption, WalletContextType, WalletProviderProps } from "./hooks/useWallet";
export { WalletProvider, useWallet } from "./hooks/useWallet";
export { sessionKeyService } from "./services/SessionKeyService";
export type { SessionKey, AccountInfo } from "./services/IndexerService";
export { IndexerService } from "./services/IndexerService";
export { NodeService } from "./services/NodeService";
export { getAuthErrorMessage } from "./utils/errorMessages";
export * as WalletOperations from "./services/WalletOperations";
