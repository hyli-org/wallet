import EC from 'elliptic';
import { SHA256 } from 'crypto-js';
import { addSessionKey, Secp256k1Blob, serializeIdentityAction, serializeSecp256k1Blob, WalletAction, walletContractName } from '../types/wallet';
import { build_proof_transaction, build_blob as check_secret_blob } from 'hyle-check-secret';
import { Buffer } from 'buffer';
import { Blob, BlobTransaction } from "hyle";
import { nodeService } from './NodeService';

export class SessionKeyService {
  private ec: EC.ec;

  constructor() {
    this.ec = new EC.ec('secp256k1');
  }

  generateSessionKey(): [string, string] {
    // Génère une paire de clés ECDSA
    const keyPair = this.ec.genKeyPair();
    
    const privateKey = keyPair.getPrivate('hex');
    if (!privateKey) {
      throw new Error('Failed to generate private key');
    }

    const publicKey = keyPair.getPublic(true, 'hex');
    if (!publicKey) {
      throw new Error('Failed to generate public key');
    }

    return [publicKey, privateKey];
  }

  async registerSessionKey(accountName: string, password: string, expiration: number, privateKey: string, whitelist: string[]): Promise<[string, string]> {
    const keyPair = this.ec.keyFromPrivate(privateKey);
    const publicKey = keyPair.getPublic(true, 'hex');
    if (!publicKey) {
      throw new Error('Failed to derive public key from private key');
    }
    try {
      const identity = `${accountName}@${walletContractName}`;
      const blob0 = await check_secret_blob(identity, password);
      const blob1 = addSessionKey(accountName, publicKey, expiration, whitelist);

      const blobTx: BlobTransaction = {
        identity,
        blobs: [blob0, blob1],
      };

      // Send transaction to add session key
      const blobTxHash = await nodeService.client.sendBlobTx(blobTx);

      const proofTx = await build_proof_transaction(
        identity,
        password,
        blobTxHash,
        0,
        blobTx.blobs.length,
      );

      const proofTxHash = await nodeService.client.sendProofTx(proofTx);
      return [blobTxHash, proofTxHash];
    } catch (error) {
      console.error('Failed to initialize session key:', error);
      throw error;
    }
  }

  getSignedBlob(identity: string, nonce: number, privateKey: string): Secp256k1Blob {
    const hash = SHA256(nonce.toString());
    const hashBytes = Buffer.from(hash.toString(), 'hex');

    if (hashBytes.length !== 32) {
      throw new Error('Hash length is not 32 bytes');
    }
    
    const keyPair = this.ec.keyFromPrivate(privateKey);
    const publicKey = keyPair.getPublic(true, 'hex');
    const signature = keyPair.sign(hash.toString());

    // Normaliser s en utilisant min(s, n-s)
    const n = this.ec.curve.n;
    var s = signature.s;
    if (s.gt(n.shrn(1))) {
      signature.s = n.sub(s);
    }

    const signatureBytes = new Uint8Array([...signature.r.toArray('be', 32), ...signature.s.toArray('be', 32)]);
    
    const secp256k1Blob: Secp256k1Blob = {
      identity: identity,
      data: hashBytes,
      public_key: new Uint8Array(Buffer.from(publicKey, 'hex')),
      signature: signatureBytes,
    };
    return secp256k1Blob;
  }

  useSessionKey(account: string, privateKey: string): [Blob, Blob] {
    const publicKey = this.ec.keyFromPrivate(privateKey).getPublic(true, 'hex');
    let nonce = Date.now();

    const action: WalletAction = {
      UseSessionKey: { account, key: publicKey, nonce }
    };

    const identity = `${account}@${walletContractName}`;
    const secp256k1Blob: Secp256k1Blob = this.getSignedBlob(identity, nonce, privateKey);
    const blob0: Blob = {
      contract_name: "secp256k1",
      data: serializeSecp256k1Blob(secp256k1Blob),
    };

    const blob1: Blob = {
      contract_name: walletContractName,
      data: serializeIdentityAction(action),
    };
    return [blob0, blob1];
  }

  clear(publicKey: string): void {
    localStorage.removeItem(publicKey);
  }
}

export const sessionKeyService = new SessionKeyService();
