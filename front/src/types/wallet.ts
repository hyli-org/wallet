export interface Transaction {
  id: string;
  type: string;
  amount: number;
  address: string;
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

export type IdentityAction =
  | {
      RegisterIdentity: {
        account: string;
        nonce: number;
      };
    }
  | {
      VerifyIdentity: {
        nonce: number;
        account: string;
      };
    };

//
// Builders
//

export const register = (account: string, nonce: number): Blob => {
  const action: IdentityAction = {
    RegisterIdentity: { account, nonce },
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
  }),
  VerifyIdentity: BorshSchema.Struct({
    account: BorshSchema.String,
    nonce: BorshSchema.u128,
  }),
});
