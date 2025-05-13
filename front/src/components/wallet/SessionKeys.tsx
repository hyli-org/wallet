import { useState, useEffect } from 'react';
import { Wallet, addSessionKey, removeSessionKey } from 'hyle-wallet/src';
import { nodeService } from '../../services/NodeService';
import { indexerService } from '../../services/IndexerService';
import { webSocketService } from '../../services/WebSocketService';
import { useSessionKey } from 'hyle-wallet/src/hooks/useSessionKey';
import { build_proof_transaction, build_blob as check_secret_blob } from 'hyle-check-secret';
import { BlobTransaction } from 'hyle';
import './SessionKeys.css';
import { walletContractName } from 'hyle-wallet/src/types/wallet';

interface SessionKeysProps {
  wallet: Wallet;
}

interface SessionKey {
  key: string;
  expiration_date: number;
  nonce: number;
}

const truncateKey = (key: string) => {
    if (key.length <= 6) return key;
    return `${key.slice(0, 3)}[...]${key.slice(-3)}`;
  };

export const SessionKeys = ({ wallet }: SessionKeysProps) => {
  const [sessionKeys, setSessionKeys] = useState<SessionKey[]>([]);
  const [password, setPassword] = useState('password123');
  const [expirationDays, setExpirationDays] = useState('7');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [transactionHash, setTransactionHash] = useState('');

  const { generateSessionKey, clearSessionKey, createSignedBlobs } = useSessionKey();

  const fetchSessionKeys = async () => {
    try {
      const accountInfo = await indexerService.getAccountInfo(wallet.username);
      setSessionKeys(accountInfo.session_keys);
    } catch (error) {
      console.error('Failed to fetch session keys:', error);
      setError('Failed to load session keys');
    }
  };

  useEffect(() => {
    fetchSessionKeys();
  }, [wallet.address, wallet.username]);

  const handleAddKey = async () => {
    if (!password) {
      setError('Please enter your password');
      return;
    }

    const days = parseInt(expirationDays);
    if (isNaN(days) || days <= 0) {
      setError('Please enter a valid expiration period');
      return;
    }

    setIsLoading(true);
    setError('');
    setStatus('Generating new session key...');
    setTransactionHash('');

    // Génère une nouvelle paire de clés
    const [publicKey, privateKey] = generateSessionKey();
    localStorage.setItem(publicKey, privateKey);
    try {

      const identity = `${wallet.username}@${walletContractName}`;
      const blob0 = await check_secret_blob(identity, password);
      const expiration = Date.now() + (days * 24 * 60 * 60 * 1000);
      const blob1 = addSessionKey(wallet.username, publicKey, expiration);

      const blobTx: BlobTransaction = {
        identity,
        blobs: [blob0, blob1],
      };

      setStatus('Verifying identity...');
      const tx_hash = await nodeService.client.sendBlobTx(blobTx);
      setTransactionHash(tx_hash);

      setStatus('Building proof transaction (this may take a few moments)...');
      const proofTx = await build_proof_transaction(
        identity,
        password,
        tx_hash,
        0,
        blobTx.blobs.length,
      );

      setStatus('Sending proof transaction...');
      await nodeService.client.sendProofTx(proofTx);
      setStatus('Waiting for confirmation...');
      
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          webSocketService.unsubscribeFromWalletEvents();
          reject(new Error('Operation timed out'));
        }, 30000);

        webSocketService.connect(identity);
        const unsubscribe = webSocketService.subscribeToWalletEvents((event) => {
          if (event.event === 'Session key added') {
            clearTimeout(timeout);
            unsubscribe();
            webSocketService.disconnect();
            resolve(event);
          }
        });
      });

      setStatus('Session key added successfully');
      setPassword('password123');
      await fetchSessionKeys();
    } catch (error) {
      setError('Failed to add session key: ' + error);
      clearSessionKey(publicKey); // Remove key from local storage if it fails
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveKey = async (key: string) => {
    setIsLoading(true);
    setError('');
    setStatus('Removing session key...');
    setTransactionHash('');

    try {
      const identity = `${wallet.username}@${walletContractName}`;
      const blob0 = await check_secret_blob(identity, password);
      const blob1 = removeSessionKey(wallet.username, key);

      const blobTx: BlobTransaction = {
        identity,
        blobs: [blob0, blob1],
      };

      const tx_hash = await nodeService.client.sendBlobTx(blobTx);
      setTransactionHash(tx_hash);

      setStatus('Waiting for confirmation...');
      
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          webSocketService.unsubscribeFromWalletEvents();
          reject(new Error('Operation timed out'));
        }, 30000);

        webSocketService.connect(wallet.address);
        const unsubscribe = webSocketService.subscribeToWalletEvents((event) => {
          if (event.event === 'Session key removed') {
            clearTimeout(timeout);
            unsubscribe();
            webSocketService.disconnect();
            resolve(event);
          }
        });
      });

      setStatus('Session key removed successfully');
      await fetchSessionKeys();
    } catch (error) {
      setError('Failed to remove session key: ' + error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendTransactionWithSessionKey = async (key: string) => {
    setIsLoading(true);
    setError('');
    setStatus('Sending transaction...');
    setTransactionHash('');

    try {
      const identity = `${wallet.username}@${walletContractName}`;
      const [blob0, blob1] = createSignedBlobs(wallet.username, key, "Hello world!");

      const blobTx: BlobTransaction = {
        identity,
        blobs: [blob0, blob1],
      };

      const tx_hash = await nodeService.client.sendBlobTx(blobTx);
      setTransactionHash(tx_hash);

      setStatus('Waiting for transaction confirmation...');

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          webSocketService.unsubscribeFromWalletEvents();
          reject(new Error('Transaction timed out'));
        }, 30000);

        webSocketService.connect(wallet.address);
        const unsubscribe = webSocketService.subscribeToWalletEvents((event) => {
          // TODO: Handle events in a more generic way
          if (event.event === 'Session key is valid') {
            clearTimeout(timeout);
            unsubscribe();
            webSocketService.disconnect();
            resolve(event);
          }
        });
      });

      setStatus('Transaction completed successfully');
    } catch (error) {
      setError('Failed to send transaction: ' + error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="session-keys-section">
      <h2>Session Keys</h2>
      
      <div className="add-key-section">
        <h3>Add New Session Key</h3>
        <div className="form-group">
          <div className="input-group">
            <label htmlFor="password">Wallet Password</label>
            <div className="input-with-description">
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your wallet password"
              disabled={isLoading}
              />
            </div>
          </div>
          <div className="input-group">
            <label htmlFor="expiration">Key Validity Period</label>
            <div className="input-with-description">
              <input
                id="expiration"
                type="number"
                value={expirationDays}
                onChange={(e) => setExpirationDays(e.target.value)}
                placeholder="Number of days"
                min="1"
                disabled={isLoading}
              />
              <span className="input-hint">days</span>
            </div>
          </div>
          <button
            onClick={handleAddKey}
            disabled={isLoading}
            className="add-key-button"
          >
            {isLoading ? 'Adding...' : 'Generate New Key'}
          </button>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}
      {status && <div className="status-message">{status}</div>}
      {transactionHash && (
        <div className="transaction-hash">
          Transaction:&nbsp;
          <code>
            <a href={`${import.meta.env.VITE_TX_EXPLORER_URL}/tx/${transactionHash}`} target="_blank">
              {`${transactionHash.slice(0, 10)}...${transactionHash.slice(-10)}`}
            </a>
          </code>
        </div>
      )}

      <div className="session-keys-list">
        <h3>Active Session Keys</h3>
        {sessionKeys.length === 0 ? (
          <p>No session keys found</p>
        ) : (
          <ul>
            {sessionKeys.map((key) => (
              <li key={key.key} className="session-key-item">
                <div className="key-info">
                  <span className="key-value">{truncateKey(key.key)}</span>
                  <span className="key-expiration">
                    Expires: {new Date(key.expiration_date).toLocaleDateString()}
                  </span>
                  <span className="key-nonce">
                    Uses: {key.nonce}
                  </span>
                </div>
                <button
                  onClick={() => handleSendTransactionWithSessionKey(key.key)}
                  disabled={isLoading}
                  className="send-transaction-button"
                >
                  Send Transaction
                </button>
                <button
                  onClick={() => handleRemoveKey(key.key)}
                  disabled={isLoading}
                  className="remove-key-button"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
