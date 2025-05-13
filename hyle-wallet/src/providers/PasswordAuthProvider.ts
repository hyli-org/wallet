import { Buffer } from 'buffer';
import { AuthProvider, AuthCredentials, AuthResult } from './BaseAuthProvider';
import { Wallet, register, verifyIdentity, walletContractName } from '../types/wallet';
import { nodeService } from '../services/NodeService';
import { webSocketService } from '../services/WebSocketService';
import { build_proof_transaction, build_blob as check_secret_blob, register_contract } from 'hyle-check-secret';
import { BlobTransaction } from 'hyle';

export interface PasswordAuthCredentials extends AuthCredentials {
  password: string;
  confirmPassword?: string;
}

export class PasswordAuthProvider implements AuthProvider {
  type = 'password';

  isEnabled(): boolean {
    return true;
  }

  async login(credentials: PasswordAuthCredentials, onBlobSent?: (wallet: Wallet) => void): Promise<AuthResult> {
    try {
      const { username, password } = credentials;
      
      if (!username || !password) {
        return { success: false, error: 'Please fill in all fields' };
      }

      const identity = `${username}@${walletContractName}`;
      const blob0 = await check_secret_blob(identity, password);
      const blob1 = verifyIdentity(username, Date.now());

      const blobTx: BlobTransaction = {
        identity,
        blobs: [blob0, blob1],
      };

      const tx_hash = await nodeService.client.sendBlobTx(blobTx);

      // Optimistic notification to the caller that the blobTx has been sent successfully
      const optimisticWallet: Wallet = {
        username,
        address: identity,
      };
      onBlobSent?.(optimisticWallet);

      // TODO: Execute noir circuit to make sure the blobTx is valid

      // Build and send the proof transaction (may take some time)
      const proofTx = await build_proof_transaction(
        identity,
        password,
        tx_hash,
        0,
        blobTx.blobs.length,
      );

      await nodeService.client.sendProofTx(proofTx);

      // Wait for on-chain settlement (existing behaviour)
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          webSocketService.unsubscribeFromWalletEvents();
          reject(new Error('Identity verification timed out'));
        }, 30000);

        webSocketService.connect(identity);
        const unsubscribeWalletEvents = webSocketService.subscribeToWalletEvents((event) => {
          const msg = event.event.toLowerCase();
          if (msg.includes('identity verified')) {
            clearTimeout(timeout);
            unsubscribeWalletEvents();
            webSocketService.disconnect();
            resolve(event);
          } else if (msg.includes('failed') || msg.includes('error')) {
            clearTimeout(timeout);
            unsubscribeWalletEvents();
            webSocketService.disconnect();
            reject(new Error(event.event));
          }
        });
      });

      const wallet: Wallet = {
        username,
        address: identity
      };

      return { success: true, wallet };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Invalid credentials or wallet does not exist'
      };
    }
  }

  async register(credentials: PasswordAuthCredentials, onBlobSent?: (wallet: Wallet) => void): Promise<AuthResult> {
    try {
      const { username, password, confirmPassword } = credentials;

      if (!username || !password || !confirmPassword) {
        return { success: false, error: 'Please fill in all fields' };
      }

      if (password !== confirmPassword) {
        return { success: false, error: 'Passwords do not match' };
      }

      if (password.length < 8) {
        return { success: false, error: 'Password must be at least 8 characters long' };
      }

      const identity = `${username}@${walletContractName}`;
      const blob0 = await check_secret_blob(identity, password);
      const hash = Buffer.from(blob0.data).toString('hex');
      const blob1 = register(username, Date.now(), hash);

      const blobTx: BlobTransaction = {
        identity,
        blobs: [blob0, blob1],
      };

      await register_contract(nodeService.client as any);
      const tx_hash = await nodeService.client.sendBlobTx(blobTx);
      
      // Optimistic notification to the caller that the blobTx has been sent successfully
      const optimisticWallet: Wallet = {
        username,
        address: identity,
      };
      onBlobSent?.(optimisticWallet);

      // Build and send the proof transaction (may take some time)
      const proofTx = await build_proof_transaction(
        identity,
        password,
        tx_hash,
        0,
        blobTx.blobs.length,
      );

      await nodeService.client.sendProofTx(proofTx);

      // Wait for on-chain settlement (existing behaviour)
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          webSocketService.unsubscribeFromWalletEvents();
          reject(new Error('Wallet creation timed out'));
        }, 60000);

        webSocketService.connect(identity);
        const unsubscribeWalletEvents = webSocketService.subscribeToWalletEvents((event) => {
          const msg = event.event.toLowerCase();
          if (msg.startsWith('successfully registered identity')) {
            clearTimeout(timeout);
            unsubscribeWalletEvents();
            webSocketService.disconnect();
            resolve(event);
          } else if (msg.includes('failed') || msg.includes('error')) {
            clearTimeout(timeout);
            unsubscribeWalletEvents();
            webSocketService.disconnect();
            reject(new Error(event.event));
          }
        });
      });

      const wallet: Wallet = {
        username,
        address: identity
      };

      return { success: true, wallet };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to create wallet'
      };
    }
  }
}