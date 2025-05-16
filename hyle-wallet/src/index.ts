export { HyleWallet } from './components/HyleWallet';
export { PasswordAuthProvider } from './providers/PasswordAuthProvider';
export type { AuthProvider, AuthCredentials } from './types/auth';
export type { AuthMethod, Wallet, WalletAction, Transaction } from './types/wallet';
export { walletContractName } from './types/wallet';
export {
  registerBlob as register,
  verifyIdentityBlob as verifyIdentity,
  addSessionKeyBlob as addSessionKey,
  removeSessionKeyBlob as removeSessionKey,
  serializeSecp256k1Blob,
  serializeIdentityAction,
  deserializeIdentityAction,
  setWalletContractName
} from './types/wallet';
export type { ProviderOption } from './hooks/useWallet';
export { WalletProvider, useWallet } from './hooks/useWallet';
export { useConfig } from './hooks/useConfig';
export { sessionKeyService } from './services/SessionKeyService';