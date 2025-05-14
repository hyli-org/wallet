import { Wallet } from '../types/wallet';

export interface AuthCredentials {
  username: string;
  [key: string]: any;
}

export interface AuthResult {
  success: boolean;
  wallet?: Wallet;
  error?: string;
}

export interface AuthProvider {
  type: string;
  login(credentials: AuthCredentials, onBlobSent?: (wallet: Wallet) => void): Promise<AuthResult>;
  register(credentials: AuthCredentials, onBlobSent?: (wallet: Wallet) => void): Promise<AuthResult>;
  isEnabled(): boolean;
}