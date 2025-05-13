import { useState } from 'react';
import { verifyIdentity, Wallet } from '../../types/wallet';
import { nodeService } from '../../services/NodeService';
import { webSocketService } from '../../services/WebSocketService';
import { build_proof_transaction, build_blob as check_secret_blob } from 'hyle-check-secret';
import { BlobTransaction } from 'hyle';

interface LoginWalletProps {
  onWalletLoggedIn: (wallet: Wallet) => void;
}

export const LoginWallet = ({ onWalletLoggedIn }: LoginWalletProps) => {
  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [status, setStatus] = useState<string>('');
  const [transactionHash, setTransactionHash] = useState<string>('');

  const handleLogin = async () => {
    setError('');
    setIsLoading(true);
    setStatus('Validating credentials...');

    if (!username || !password) {
      setError('Please fill in all fields');
      setIsLoading(false);
      return;
    }
    const blob1 = verifyIdentity(username, Date.now());

    const identity = `${username}@${blob1.contract_name}`;
    const blob0 = await check_secret_blob(identity, password);

    const blobTx: BlobTransaction = {
      identity,
      blobs: [blob0, blob1],
    }

    try {
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
      setStatus('Waiting for transaction confirmation...');

      try {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            webSocketService.unsubscribeFromWalletEvents();
            reject(new Error('Identity verification timed out'));
          }, 30000);

          webSocketService.connect(identity);
          const unsubscribeWalletEvents = webSocketService.subscribeToWalletEvents((event) => {
            console.log('Received wallet event:', event);
            if (event.event === 'Identity verified') {
              clearTimeout(timeout);
              unsubscribeWalletEvents();
              webSocketService.disconnect();
              resolve(event);
            }
          });
        });
      } catch (error) {
        setError('' + error);
        setStatus('');
        console.error('Transaction error:', error);
        return;
      }
      setStatus('Logged in successfully!');

      const wallet: Wallet = {
        username,
        address: identity
      };

      onWalletLoggedIn(wallet);
    } catch (error) {
      setError('Invalid credentials or wallet does not exist');
      console.error('Login error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="wallet-login-container">
      <h1>Login to Your Wallet</h1>
      <div className="wallet-login-form">
        <div className="form-group">
          <label htmlFor="username">Username</label>
          <input
            id="username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Enter your username"
          />
        </div>
        <div className="form-group">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
          />
        </div>
        {error && <div className="error-message">{error}</div>}
        {status && <div className="status-message">{status}</div>}
        <button
          onClick={handleLogin}
          className="login-wallet-button"
          disabled={isLoading}
        >
          {isLoading ? 'Logging in...' : 'Login'}
        </button>
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

      </div>
    </div>
  );
};

