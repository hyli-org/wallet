import { useState } from 'react';
import { Transaction } from '../../types/wallet';

interface SendProps {
  onSend: (transaction: Omit<Transaction, 'id' | 'timestamp'>) => void;
}

export const Send = ({ onSend }: SendProps) => {
  const [amount, setAmount] = useState<string>('');
  const [address, setAddress] = useState<string>('');

  const handleSend = () => {
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      alert('Please enter a valid amount');
      return;
    }
    if (!address) {
      alert('Please enter a valid address');
      return;
    }

    onSend({
      type: 'send',
      amount: parsedAmount,
      address
    });

    setAmount('');
    setAddress('');
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
        <button onClick={handleSend}>Send</button>
      </div>
    </div>
  );
}; 