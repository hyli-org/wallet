import { useState } from 'react';
import { register, Wallet } from '../../types/wallet';
import { build_proof_transaction, build_blob as check_secret_blob, register_contract } from 'hyle-check-secret';
import { BlobTransaction } from 'hyle';
import { nodeService } from '../../services/NodeService';
import { webSocketService } from '../../services/WebSocketService';

interface CreateWalletProps {
  onWalletCreated: (wallet: Wallet) => void;
}

export const CreateWallet = ({ onWalletCreated }: CreateWalletProps) => {
  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [status, setStatus] = useState<string>('');
  const [transactionHash, setTransactionHash] = useState<string>('');

  const handleCreateWallet = async () => {
    setError('');
    setIsLoading(true);
    setStatus('Validating input...');

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
    const blob1 = register(username, Date.now());

    const identity = `${username}@${blob1.contract_name}`;
    console.log('Identity:', identity);
    const blob0 = await check_secret_blob(identity, password);

    const blobTx: BlobTransaction = {
      identity,
      blobs: [blob0, blob1],
    }

    try {
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
      } catch (error) {
        setError('' + error);
        setStatus('');
        console.error('Wallet creation error:', error);
        return;
      }

      setStatus('Wallet created successfully!');

      const wallet: Wallet = {
        username,
        address: identity
      };

      onWalletCreated(wallet);
    } catch (error) {
      setError('Failed to create wallet. Please try again.');
      console.error('Error creating wallet:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="wallet-creation-container">
      <h1>Create Your Wallet</h1>
      <div className="wallet-creation-form">
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
        {error && <div className="error-message">{error}</div>}
        {status && <div className="status-message">{status}</div>}
        <button
          onClick={handleCreateWallet}
          className="create-wallet-button"
          disabled={isLoading}
        >
          {isLoading ? 'Creating Wallet...' : 'Create Wallet'}
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
        <p>
          The password is used to encrypt your wallet. Make sure to remember it, as it will be required for future logins. It isn't stored on any server, there is no recovery possible.
        </p>
        <p>
          The wallet is created using zk proofs, ensuring that your credentials are never exposed. The password is hashed with your wallet id and stored securely on the blockchain.
        </p>
        <p>
          Your username is unique and will be used to identify your wallet. Make sure to choose a name that you will remember.
        </p>
        <p>
          After creating your wallet, you will be able to send and receive transactions using your unique wallet address.
        </p>
        <p>
          If you have any questions or need assistance, please contact our support team.
        </p>
      </div>
    </div>
  );
}; 
