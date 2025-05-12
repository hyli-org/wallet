import { Buffer } from 'buffer';

export interface Transaction {
  id: string;
  type: string;
  amount: number;
  address: string;
  status: string;
  timestamp: number;
}

export interface Wallet {
  username: string;
  address: string;
}

import { borshSerialize, BorshSchema, borshDeserialize } from "borsher";
import { Blob } from "hyle";
import { walletContractName } from 'hyle-wallet/src/types/wallet';

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
        message: string;
      };
    }
  | {
      UseSessionKey: {
        account: string;
        key: string;
        message: string;
      };
    };

//
// Builders
//

export const register = (account: string, nonce: number, hash: string): Blob => {
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

export const verifyIdentity = (account: string, nonce: number): Blob => {
  const action: WalletAction = {
    VerifyIdentity: { nonce, account },
  };

  const blob: Blob = {
    contract_name: walletContractName,
    data: serializeIdentityAction(action),
  };
  return blob;
};

export const addSessionKey = (account: string, key: string, expiration: number): Blob => {
  const action: WalletAction = {
    AddSessionKey: { account, key, expiration }
  };
  const blob: Blob = {
    contract_name: walletContractName,
    data: serializeIdentityAction(action),
  };
  return blob;
};

export const removeSessionKey = (account: string, key: string): Blob => {
  const action: WalletAction = {
    RemoveSessionKey: { account, key }
  };
  const blob: Blob = {
    contract_name: walletContractName,
    data: serializeIdentityAction(action),
  };
  return blob;
};

// Removed the `useSessionKey` function as it has been moved to `SessionKeyService`.

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
  }),
  RemoveSessionKey: BorshSchema.Struct({
    account: BorshSchema.String,
    key: BorshSchema.String,
  }),
UseSessionKey: BorshSchema.Struct({
    account: BorshSchema.String,
    message: BorshSchema.String,
  }),
});
