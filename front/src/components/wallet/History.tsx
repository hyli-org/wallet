import { Transaction } from '../../types/wallet';

interface HistoryProps {
  transactions: Transaction[];
}

export const History = ({ transactions }: HistoryProps) => {
  return (
    <div className="history-section">
      <h2>Transaction History</h2>
      <div className="transactions-list">
        {transactions.map((tx) => (
          <div key={tx.id} className={`transaction ${tx.type}`}>
            <div className="transaction-header">
              <span className="type">{tx.type.toUpperCase()}</span>
              <span className="amount">{tx.amount} ETH</span>
            </div>
            <div className="transaction-details">
              <p>Address: {tx.address}</p>
              <p>Date: {new Date(tx.timestamp).toLocaleString()}</p>
            </div>
          </div>
        ))}
        {transactions.length === 0 && (
          <p className="no-transactions">No transactions yet</p>
        )}
      </div>
    </div>
  );
}; 