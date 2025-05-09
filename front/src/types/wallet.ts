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

export let walletContractName = "wallet"; // Default value that will be updated

export const setWalletContractName = (name: string) => {
  walletContractName = name;
};

//
// Types
//

export type AuthMethod = {
  Password: {
    hash: string;
  };
};

export type IdentityAction =
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
      };
    };

//
// Builders
//

export const register = (account: string, nonce: number, hash: string): Blob => {
  const action: IdentityAction = {
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
  const action: IdentityAction = {
    VerifyIdentity: { nonce, account },
  };

  const blob: Blob = {
    contract_name: walletContractName,
    data: serializeIdentityAction(action),
  };
  return blob;
};

export const addSessionKey = (account: string, key: string, expiration: number): Blob => {
  const action: IdentityAction = {
    AddSessionKey: { account, key, expiration }
  };
  const blob: Blob = {
    contract_name: walletContractName,
    data: serializeIdentityAction(action),
  };
  return blob;
};

export const removeSessionKey = (account: string, key: string): Blob => {
  const action: IdentityAction = {
    RemoveSessionKey: { account, key }
  };
  const blob: Blob = {
    contract_name: walletContractName,
    data: serializeIdentityAction(action),
  };
  return blob;
};

export const useSessionKey = (account: string, key: string): Blob => {
  const action: IdentityAction = {
    UseSessionKey: { account, key }
  };
  const blob: Blob = {
    contract_name: walletContractName,
    data: serializeIdentityAction(action),
  };
  return blob;
};

//
// Serialisation
//

const serializeIdentityAction = (action: IdentityAction): number[] => {
  return Array.from(borshSerialize(schema, action));
};
export const deserializeIdentityAction = (data: number[]): IdentityAction => {
  return borshDeserialize(schema, Buffer.from(data));
};

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
    key: BorshSchema.String,
  }),
});
