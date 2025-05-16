import { useState, useEffect } from 'react';
import { serializeIdentityAction, serializeSecp256k1Blob, sessionKeyService, useWallet, WalletAction, walletContractName } from 'hyle-wallet';
import { webSocketService } from '../../services/WebSocketService';
import { Blob, BlobTransaction } from 'hyle';
import { indexerService } from '../../services/IndexerService';
import './SessionKeys.css';
import { nodeService } from '../../services/NodeService';

interface SessionKey {
  key: string;
  expiration_date: number;
  nonce: number;
}

export const SessionKeys = () => {
  const { wallet, registerSessionKey, removeSessionKey } = useWallet();

  if (!wallet) {
    return <div>Please connect your wallet first</div>;
  }
  
  const [sessionKeys, setSessionKeys] = useState<SessionKey[]>([]);
  const [password, setPassword] = useState('password123');
  const [expirationDays, setExpirationDays] = useState('7');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [transactionHash, setTransactionHash] = useState('');

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
  }, [wallet.username]);

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

    try {
      const expiration = Date.now() + (days * 24 * 60 * 60 * 1000);
      
      const { sessionKey } = await registerSessionKey(
        password,
        expiration,
        ["hyllar"],
        (txHash: string, type: string) => {
          if (type === 'blob') {
            setStatus('Verifying identity...');
            setTransactionHash(txHash);
          } else if (type === 'proof') {
            setStatus('Proof transaction sent, waiting for confirmation...');
          }
        }
      );

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          webSocketService.unsubscribeFromWalletEvents();
          reject(new Error('Operation timed out'));
        }, 30000);

        const unsubscribe = webSocketService.subscribeToWalletEvents((event) => {
          if (event.event === 'Session key added') {
            localStorage.setItem(sessionKey.publicKey, sessionKey.privateKey);
            clearTimeout(timeout);
            unsubscribe();
            resolve(event);
          }
        });
      });

      setStatus('Session key added successfully');
      setPassword('password123');
      await fetchSessionKeys();
    } catch (error) {
      setError('Failed to add session key: ' + error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveKey = async (publicKey: string) => {
    setIsLoading(true);
    setError('');
    setStatus('Removing session key...');
    setTransactionHash('');

    try {
      await removeSessionKey(
        password,
        publicKey,
        (txHash: string, type: string) => {
          if (type === 'blob') {
            setStatus('Verifying identity...');
            setTransactionHash(txHash);
          } else if (type === 'proof') {
            setStatus('Proof transaction sent, waiting for confirmation...');
          }
        }
      );


      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          webSocketService.unsubscribeFromWalletEvents();
          reject(new Error('Operation timed out'));
        }, 30000);

        webSocketService.connect(wallet.address);
        const unsubscribe = webSocketService.subscribeToWalletEvents((event) => {
          if (event.event === 'Session key removed') {
            localStorage.removeItem(publicKey);
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

  const handleSendTransactionWithSessionKey = async (publicKey: string) => {
    setIsLoading(true);
    setError('');
    setStatus('Sending transaction...');
    setTransactionHash('');

    try {

      const identity = wallet.address;
      const privateKey = localStorage.getItem(publicKey);
      if (!privateKey) {
        throw new Error('Private key not found in local storage');
      }

      let nonce = Date.now();
      const secp256k1Blob = sessionKeyService.getSignedBlob(wallet.address, nonce, privateKey);

      const blob0: Blob = {
        contract_name: "secp256k1",
        data: serializeSecp256k1Blob(secp256k1Blob),
      };

      const action: WalletAction = {
        UseSessionKey: { 
          account: wallet.username, 
          key: publicKey, 
          nonce 
        }
      };
      const blob1: Blob = {
        contract_name: walletContractName,
        data: serializeIdentityAction(action),
      };

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

  const truncateKey = (key: string) => {
    if (key.length <= 6) return key;
    return `${key.slice(0, 3)}[...]${key.slice(-3)}`;
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
            <a href={`${import.meta.env.VITE_TX_EXPLORER_URL}/tx/${transactionHash}`} target="_blank" rel="noreferrer">
              {truncateKey(transactionHash)}
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
                    Nonce: {key.nonce}
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
