export { HyliWallet } from "./components/HyliWallet";
export { PasswordAuthProvider } from "./providers/PasswordAuthProvider";
export type { AuthProvider, AuthCredentials } from "./types/auth";
export type {
    AuthMethod,
    Wallet,
    WalletAction,
    WalletEventCallback,
    WalletEvent,
    LoginStage,
    RegistrationStage,
} from "./types/wallet";
export { walletContractName } from "./types/wallet";
export type { WalletConfig } from "./services/ConfigService";
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
export { getAuthErrorMessage } from "./utils/errorMessages";
