import { Buffer } from 'buffer';

export interface Transaction {
  id: string;
  type: string;
  amount: number;
  address: string;
  status: string;
  timestamp: number;
}

export interface SessionKey {
  publicKey: string;
  privateKey: string;
  expiration: number;
  whitelist: string[];
}

export interface Wallet {
  username: string;
  address: string;
  sessionKey?: SessionKey;
}

import { borshSerialize, BorshSchema, borshDeserialize } from "borsher";
import { Blob } from "hyle";

export let walletContractName = "wallet"; // Default value that will be updated

export const setWalletContractName = (name: string) => {
  walletContractName = name;
};

//
// Types
//
 
export type Secp256k1Blob = {
  identity: String;
  data: Uint8Array;
  public_key: Uint8Array;
  signature: Uint8Array;
};

export type AuthMethod = {
  Password: {
    hash: string;
  };
};

export type WalletAction =
  | {
      RegisterIdentity: {
        account: string;
        nonce: number;
        auth_method: AuthMethod;
      };
    }
  | {
      VerifyIdentity: {
        nonce: number;
        account: string;
      };
    }
  | {
      AddSessionKey: {
        account: string;
        key: string;
        expiration: number;
        whitelist: string[];
      };
    }
  | {
      RemoveSessionKey: {
        account: string;
        key: string;
      };
    }
  | {
      UseSessionKey: {
        account: string;
        key: string;
        nonce: number;
      };
    }

// Callback pour les transactions
export type TransactionCallback = (txHash: string, type: string, wallet?: Wallet) => void;

//
// Builders
//

export const registerBlob = (account: string, nonce: number, hash: string): Blob => {
  const action: WalletAction = {
    RegisterIdentity: { 
      account, 
      nonce,
      auth_method: { Password: { hash } },
    },
  };
  const blob: Blob = {
    contract_name: walletContractName,
    data: serializeIdentityAction(action),
  };
  return blob;
};

export const verifyIdentityBlob = (account: string, nonce: number): Blob => {
  const action: WalletAction = {
    VerifyIdentity: { nonce, account },
  };

  const blob: Blob = {
    contract_name: walletContractName,
    data: serializeIdentityAction(action),
  };
  return blob;
};

export const addSessionKeyBlob = (account: string, key: string, expiration: number, whitelist: string[]): Blob => {
  const action: WalletAction = {
    AddSessionKey: { account, key, expiration, whitelist }
  };
  const blob: Blob = {
    contract_name: walletContractName,
    data: serializeIdentityAction(action),
  };
  return blob;
};

export const removeSessionKeyBlob = (account: string, key: string): Blob => {
  const action: WalletAction = {
    RemoveSessionKey: { account, key }
  };
  const blob: Blob = {
    contract_name: walletContractName,
    data: serializeIdentityAction(action),
  };
  return blob;
};

// Store wallet in localStorage
export const storeWallet = (wallet: Wallet) => {
  localStorage.setItem('wallet', JSON.stringify(wallet));
};

// Get wallet from localStorage
export const getStoredWallet = (): Wallet | null => {
  const storedWallet = localStorage.getItem('wallet');
  return storedWallet ? JSON.parse(storedWallet) : null;
};

// Clear wallet from localStorage
export const clearStoredWallet = () => {
  localStorage.removeItem('wallet');
};

//
// Serialisation
//

export const serializeSecp256k1Blob = (blob: Secp256k1Blob): number[] => {

  return Array.from(borshSerialize(secp256k1BlobSchema, blob));
};

export const serializeIdentityAction = (action: WalletAction): number[] => {
  return Array.from(borshSerialize(schema, action));
};
export const deserializeIdentityAction = (data: number[]): WalletAction => {
  return borshDeserialize(schema, Buffer.from(data));
};

const secp256k1BlobSchema = BorshSchema.Struct({
  identity: BorshSchema.String,
  data: BorshSchema.Array(BorshSchema.u8, 32),
  public_key: BorshSchema.Array(BorshSchema.u8, 33),
  signature: BorshSchema.Array(BorshSchema.u8, 64),
});

const schema = BorshSchema.Enum({
  RegisterIdentity: BorshSchema.Struct({
    account: BorshSchema.String,
    nonce: BorshSchema.u128,
    auth_method: BorshSchema.Enum({
      Password: BorshSchema.Struct({
        hash: BorshSchema.String,
      }),
    }),
  }),
  VerifyIdentity: BorshSchema.Struct({
    account: BorshSchema.String,
    nonce: BorshSchema.u128,
  }),
  AddSessionKey: BorshSchema.Struct({
    account: BorshSchema.String,
    key: BorshSchema.String,
    expiration: BorshSchema.u128,
    whitelist: BorshSchema.Vec(BorshSchema.String),
  }),
  RemoveSessionKey: BorshSchema.Struct({
    account: BorshSchema.String,
    key: BorshSchema.String,
  }),
  UseSessionKey: BorshSchema.Struct({
    account: BorshSchema.String,
    nonce: BorshSchema.u128,
  }),
});
