import { Transaction } from "../../services/WebSocketService";

interface HistoryProps {
    transactions: Transaction[];
}

export const History = ({ transactions }: HistoryProps) => {
    return (
        <div className="history-section">
            <h2>Transaction History</h2>
            <div className="transactions-list">
                {transactions.map((tx) => (
                    <div key={tx.id + tx.type} className={`transaction ${tx.type}`}>
                        <div className="transaction-header">
                            <span className="type">{tx.type.toUpperCase()}</span>
                            <span className="amount">
                                {tx.amount} {tx.token ? tx.token.toUpperCase() : "ORANJ"}
                            </span>
                        </div>
                        <div className="transaction-details">
                            <p>Address: {tx.address}</p>
                            <p>Date: {new Date(tx.timestamp).toLocaleString()}</p>
                            <p>
                                Transaction:{" "}
                                <a
                                    href={`${import.meta.env.VITE_TX_EXPLORER_URL}/tx/${tx.id}`}
                                    target="_blank"
                                >{`${tx.id.slice(0, 10)}...${tx.id.slice(-10)}`}</a>
                            </p>
                            <p>Status: {tx.status}</p>
                        </div>
                    </div>
                ))}
                {transactions.length === 0 && <p className="no-transactions">No transactions yet</p>}
            </div>
        </div>
    );
};
