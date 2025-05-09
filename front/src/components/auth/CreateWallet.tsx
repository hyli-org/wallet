import { useState } from 'react';
import { Buffer } from 'buffer';
import { register, Wallet, walletContractName } from '../../types/wallet';
import { build_proof_transaction, build_blob as check_secret_blob, register_contract } from 'hyle-check-secret';
import { BlobTransaction } from 'hyle';
import { nodeService } from '../../services/NodeService';
import { webSocketService } from '../../services/WebSocketService';
import { AuthMethodSelector, AuthMethodType } from './AuthMethodSelector';

interface CreateWalletProps {
  onWalletCreated: (wallet: Wallet) => void;
}

export const CreateWallet = ({ onWalletCreated }: CreateWalletProps) => {
  const [selectedAuthMethod, setSelectedAuthMethod] = useState<AuthMethodType | null>(null);
  const [username, setUsername] = useState<string>('bob');
  const [password, setPassword] = useState<string>('password123');
  const [confirmPassword, setConfirmPassword] = useState<string>('password123');
  const [error, setError] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [status, setStatus] = useState<string>('');
  const [transactionHash, setTransactionHash] = useState<string>('');

  const handleAuthMethodSelect = (method: AuthMethodType) => {
    setSelectedAuthMethod(method);
    setError('');
  };

  const handleCreateWallet = async () => {
    if (!selectedAuthMethod) {
      setError('Please select an authentication method');
      return;
    }

    setError('');
    setIsLoading(true);
    setStatus('Validating input...');

    try {
      if (selectedAuthMethod === 'password') {
        if (!username || !password || !confirmPassword) {
          setError('Please fill in all fields');
          return;
        }

        if (password !== confirmPassword) {
          setError('Passwords do not match');
          return;
        }

        if (password.length < 8) {
          setError('Password must be at least 8 characters long');
          return;
        }

        setStatus('Generating wallet credentials...');
        const identity = `${username}@${walletContractName}`;
        const blob0 = await check_secret_blob(identity, password);
        const hash = Buffer.from(blob0.data).toString('hex');
        const blob1 = register(username, Date.now(), hash);

        const blobTx: BlobTransaction = {
          identity,
          blobs: [blob0, blob1],
        }

        setStatus('Sending transaction...');
        await register_contract(nodeService.client as any);
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
        setStatus('Waiting for wallet creation confirmation...');

        try {
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              unsubscribeWalletEvents();
              reject(new Error('Wallet creation timed out'));
            }, 60000);

            webSocketService.connect(identity);
            const unsubscribeWalletEvents = webSocketService.subscribeToWalletEvents((event) => {
              console.log('Received wallet event:', event);
              if (event.event.startsWith('Successfully registered identity for account')) {
                clearTimeout(timeout);
                unsubscribeWalletEvents();
                webSocketService.disconnect();
                resolve(event);
              } else {
                clearTimeout(timeout);
                unsubscribeWalletEvents();
                webSocketService.disconnect();
                reject(new Error('Wallet creation failed: ' + event.event));
              }
            });
          });

          setStatus('Wallet created successfully!');

          const wallet: Wallet = {
            username,
            address: identity
          };

          onWalletCreated(wallet);
        } catch (error) {
          throw new Error(error instanceof Error ? error.message : 'Wallet creation failed');
        }
      }
    } catch (error) {
      setError('Failed to create wallet. Please try again.');
      console.error('Error creating wallet:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (!selectedAuthMethod) {
    return <AuthMethodSelector onSelect={handleAuthMethodSelect} />;
  }

  return (
    <div className="wallet-creation-container">
      <h1>Create Your Wallet</h1>
      <div className="wallet-creation-form">
        {selectedAuthMethod === 'password' && (
          <>
            <div className="form-group">
              <label htmlFor="username">Username</label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Choose a username"
              />
            </div>
            <div className="form-group">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Create a password"
              />
            </div>
            <div className="form-group">
              <label htmlFor="confirmPassword">Confirm Password</label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm your password"
              />
            </div>
          </>
        )}
        
        {error && <div className="error-message">{error}</div>}
        {status && <div className="status-message">{status}</div>}
        
        <div className="button-group">
          <button
            onClick={() => setSelectedAuthMethod(null)}
            className="back-button"
            disabled={isLoading}
          >
            Back to Auth Methods
          </button>
          <button
            onClick={handleCreateWallet}
            className="create-wallet-button"
            disabled={isLoading}
          >
            {isLoading ? 'Creating Wallet...' : 'Create Wallet'}
          </button>
        </div>

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
