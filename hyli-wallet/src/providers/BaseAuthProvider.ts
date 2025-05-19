import { Wallet } from '../types/wallet';

export interface AuthCredentials {
  username: string;
  [key: string]: any;
}

export interface AuthEvents {
  onTransaction?: (txHash: string, type: string) => void;
}

export interface AuthResult {
  success: boolean;
  wallet?: Wallet;
  error?: string;
}

export interface AuthProvider {
  type: string;
  login(credentials: AuthCredentials, events: AuthEvents): Promise<AuthResult>;
  register(credentials: AuthCredentials, events: AuthEvents): Promise<AuthResult>;
  isEnabled(): boolean;
}