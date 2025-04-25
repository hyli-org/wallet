import { useState } from 'react';
import { Transaction, verifyIdentity, Wallet } from '../../types/wallet';
import { blob_builder, BlobTransaction } from 'hyle'
import { build_proof_transaction, build_blob as check_secret_blob } from 'hyle-check-secret';
import { nodeService } from '../../services/NodeService';
import { webSocketService } from '../../services/WebSocketService';

interface SendProps {
  onSend?: (transaction: Omit<Transaction, 'id' | 'timestamp'>) => void;
  wallet: Wallet
}

export const Send = ({ wallet, onSend }: SendProps) => {
  const [amount, setAmount] = useState<string>('');
  const [address, setAddress] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [transactionHash, setTransactionHash] = useState<string>('');

  const handleSend = async () => {
    setError('');
    setStatus('Validating input...');
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setError('Please enter a valid amount');
      return;
    }
    if (!address) {
      setError('Please enter a valid address');
      return;
    }
    if (!password) {
      setError('Please enter your password');
      return;
    }

    const blob1 = verifyIdentity(wallet.username, Date.now());
    const identity = `${wallet.username}@${blob1.contract_name}`;
    const blob0 = await check_secret_blob(identity, password);

    const blob2 = blob_builder.token.transfer(address, "hyllar", parsedAmount, null);

    const blobTx: BlobTransaction = {
      identity,
      blobs: [blob0, blob1, blob2],
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
            unsubscribeTxEvents();
            reject(new Error('Transaction timed out'));
          }, 30000);

          webSocketService.connect(identity);
          const unsubscribeTxEvents = webSocketService.subscribeToTxEvents((event) => {
            console.log('Received tx event:', event);
            if (event.tx.id === tx_hash && event.tx.status === 'Success') {
              setStatus('Transaction completed');
              clearTimeout(timeout);
              unsubscribeTxEvents();
              webSocketService.disconnect();
              resolve(event);
            } else if (event.tx.id === tx_hash && event.tx.status != 'Sequenced') {
              clearTimeout(timeout);
              unsubscribeTxEvents();
              webSocketService.disconnect();
              reject(new Error('Transaction failed: ' + event.tx.status));
            }
          });
        });
      } catch (error) {
        setError('' + error);
        setStatus('');
        console.error('Transaction error:', error);
        return;
      }

      onSend?.({
        type: 'send',
        amount: parsedAmount,
        address,
        status: 'completed'
      });

      setAmount('');
      setAddress('');
    } catch (error) {
      setError('Transaction failed or timed out');
      console.error('Transaction error:', error);
      return;
    }
  };

  return (
    <div className="send-section">
      <div className="send-form">
        <h2>Send Funds</h2>
        <input
          type="number"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <input
          type="text"
          placeholder="Recipient Address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
        <input
          type="password"
          placeholder="Enter your password"
          onChange={(e) => setPassword(e.target.value)}
        />
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
        <button onClick={handleSend}>Send</button>
      </div>
    </div>
  );
}; 
