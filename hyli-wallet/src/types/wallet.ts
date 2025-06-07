import { Buffer } from "buffer";

export interface SessionKey {
    publicKey: string;
    privateKey: string;
    expiration: number;
    whitelist?: string[];
    laneId?: string;
}

export interface Wallet {
    username: string;
    address: string;
    salt: string;
    sessionKey?: SessionKey;
}

import { borshSerialize, BorshSchema, borshDeserialize } from "borsher";
import { Blob } from "hyli";

export let walletContractName = "wallet";

//
// Types
//

export type Secp256k1Blob = {
    identity: String;
    data: Uint8Array;
    public_key: Uint8Array;
    signature: Uint8Array;
};

export type AuthMethod = { Password: { hash: string } };

export type WalletAction =
    | {
          RegisterIdentity: {
              account: string;
              nonce: number;
              salt: string;
              auth_method: AuthMethod;
              invite_code: string;
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
              expiration_date: number;
              whitelist?: string[];
              laneId?: string;
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
              nonce: number;
          };
      };

// Callbacks
export type TransactionCallback = (txHash: string, type: string) => void;
export type WalletErrorCallback = (error: Error) => void;
export type WalletEventCallback = (event: WalletEvent) => void;
export type OnchainWalletEventCallback = (event: { event: string }) => void;

export type LoginStage = "checking_password";
export type RegistrationStage = "sending_blob" | "blob_sent" | "sending_proof" | "proof_sent";

export interface WalletEvent {
    account: string;
    type: LoginStage | RegistrationStage | "logged_in" | "custom";
    message: string;
}

//
// Builders
//

export const registerBlob = (account: string, nonce: number, salt: string, hash: string, invite_code: string): Blob => {
    const action: WalletAction = {
        RegisterIdentity: {
            account,
            nonce,
            salt,
            auth_method: { Password: { hash } },
            invite_code,
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

export const addSessionKeyBlob = (
    account: string,
    key: string,
    expiration_date: number,
    whitelist?: string[],
    laneId?: string
): Blob => {
    const action: WalletAction = {
        AddSessionKey: { account, key, expiration_date, whitelist, laneId },
    };
    const blob: Blob = {
        contract_name: walletContractName,
        data: serializeIdentityAction(action),
    };
    return blob;
};

export const removeSessionKeyBlob = (account: string, key: string): Blob => {
    const action: WalletAction = {
        RemoveSessionKey: { account, key },
    };
    const blob: Blob = {
        contract_name: walletContractName,
        data: serializeIdentityAction(action),
    };
    return blob;
};

// Store wallet in localStorage
export const storeWallet = (wallet: Wallet) => {
    localStorage.setItem("wallet", JSON.stringify(wallet));
};

// Get wallet from localStorage
export const getStoredWallet = (): Wallet | null => {
    const storedWallet = localStorage.getItem("wallet");
    return storedWallet ? JSON.parse(storedWallet) : null;
};

// Clear wallet from localStorage
export const clearStoredWallet = () => {
    localStorage.removeItem("wallet");
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
        salt: BorshSchema.String,
        auth_method: BorshSchema.Enum({
            Password: BorshSchema.Struct({
                hash: BorshSchema.String,
            }),
        }),
        invite_code: BorshSchema.String,
    }),
    VerifyIdentity: BorshSchema.Struct({
        account: BorshSchema.String,
        nonce: BorshSchema.u128,
    }),
    AddSessionKey: BorshSchema.Struct({
        account: BorshSchema.String,
        key: BorshSchema.String,
        expiration_date: BorshSchema.u128,
        whitelist: BorshSchema.Option(BorshSchema.Vec(BorshSchema.String)),
        lane_id: BorshSchema.Option(BorshSchema.String),
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
