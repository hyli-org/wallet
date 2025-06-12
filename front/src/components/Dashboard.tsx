import { useState } from "react";
import { Wallet } from "hyli-wallet";
import { useWalletBalance } from "../hooks/useWalletBalance";
import { useWalletTransactions } from "../hooks/useWalletTransactions";
import "./Dashboard.css";

interface DashboardProps {
    wallet: Wallet;
    onSendClick: () => void;
    onReceiveClick?: () => void;
}

interface TokenBalance {
    symbol: string;
    amount: number;
}

export const Dashboard = ({ wallet, onSendClick }: DashboardProps) => {
    const { balance: oranjBalance } = useWalletBalance(wallet?.address, "oranj");
    const { balance: oxygenBalance } = useWalletBalance(wallet?.address, "oxygen");
    const { balance: vitaminBalance } = useWalletBalance(wallet?.address, "vitamin");
    const { transactions } = useWalletTransactions(wallet?.address);

    const [showReceive, setShowReceive] = useState<boolean>(false);

    const tokens: TokenBalance[] = [
        { symbol: "ORANJ", amount: oranjBalance },
        { symbol: "OXYGEN", amount: oxygenBalance },
        { symbol: "VITAMIN", amount: vitaminBalance },
    ];

    const recentActivity = transactions.slice(0, 3);

    const formatAmount = (num: number): string => {
        if (num === 0) return "0";

        const k = 1000;
        const sizes = ['', 'k', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc'];
        const i = Math.floor(Math.log(num) / Math.log(k));

        return (num / Math.pow(k, i)).toFixed(i == 0 ? 0 : 3).toLocaleString() + sizes[i];
    };


    return (
        <div className="dashboard">
            {/* Hero Section - The Vault */}
            <div className="vault-section">
                <div className="vault-background">
                    <div className="floating-orbs">
                        <div className="orb orb-1" />
                        <div className="orb orb-2" />
                        <div className="orb orb-3" />
                    </div>
                </div>

                <div className="welcome-header">
                    <h1 className="welcome-title">Welcome back, {wallet.username}!</h1>
                </div>

                {/* Token Cards */}
                <div className="token-grid">
                    {tokens.map((token) => (
                        <div key={token.symbol} className="token-card">
                            <div className="token-icon">
                                <div className={`token-symbol ${token.symbol.toLowerCase()}`}>
                                    {token.symbol.charAt(0)}
                                </div>
                            </div>
                            <div className="token-info">
                                <h3 className="token-name">{token.symbol}</h3>
                                <p className="token-amount">{formatAmount(token.amount)}</p>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Action Buttons */}
                <div className="action-buttons">
                    <button className="btn-primary btn-send" onClick={onSendClick}>
                        <span className="btn-icon">⊕</span>
                        SEND
                    </button>
                    <button className="btn-primary btn-receive" onClick={() => setShowReceive(!showReceive)}>
                        <span className="btn-icon">⊖</span>
                        RECEIVE
                    </button>
                </div>
            </div>

            {/* Recent Activity */}
            <div className="activity-section">
                <h2 className="section-title">Recent Activity</h2>
                {recentActivity.length === 0 ? (
                    <div className="empty-state">
                        <div className="empty-illustration">
                            <div className="empty-icon">🏗️</div>
                        </div>
                        <h3>Your proof journey begins here</h3>
                        <p>Make your first transaction to get started</p>
                        <button className="btn-primary" onClick={onSendClick}>
                            Send Tokens
                        </button>
                    </div>
                ) : (
                    <div className="activity-list">
                        {recentActivity.map((tx) => (
                            <div
                                key={tx.id}
                                className="activity-item"
                                style={{ cursor: "pointer" }}
                                onClick={() =>
                                    window.open(`${import.meta.env.VITE_TX_EXPLORER_URL}/tx/${tx.id}`, "_blank")
                                }
                            >
                                <div className="activity-icon">
                                    {tx.type === "Send" || tx.type === "Send TransferFrom" ? "→" : "←"}
                                </div>
                                <div className="activity-details">
                                    <div className="activity-header">
                                        <span className="activity-type">{tx.type}</span>
                                    </div>
                                    <div className="activity-meta">
                                        <span className="activity-address">
                                            {tx.type === "Send" || tx.type === "Send TransferFrom" ? "To:" : "From:"}{" "}
                                            {tx.address.length > 30
                                                ? `${tx.address.slice(0, 6)}...${tx.address.slice(-4)}`
                                                : tx.address}
                                        </span>
                                        <span className="activity-time">
                                            {new Date(tx.timestamp).toLocaleTimeString()}
                                        </span>
                                    </div>
                                </div>
                                <div>
                                    <span className="activity-amount">
                                        {tx.amount.toLocaleString()} {tx.token ? tx.token.toUpperCase() : "ORANJ"}
                                    </span>
                                </div>
                                <div className={`activity-status ${tx.status.toLowerCase()}`}>
                                    {tx.status === "Success" ? "✓" : tx.status === "Failed" ? "✗" : tx.status === "Timed Out" ? "⏰" : "..."}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Receive Modal */}
            {showReceive && (
                <div className="modal-overlay" onClick={() => setShowReceive(false)}>
                    <div className="modal-content compact" onClick={(e) => e.stopPropagation()}>
                        <button className="modal-close" onClick={() => setShowReceive(false)}>
                            ×
                        </button>
                        <div className="modal-body">
                            <h3 className="modal-title">Your Wallet Address</h3>
                            <div className="address-container">
                                <code className="address-display">{wallet.address}</code>
                                <button
                                    className="btn-copy"
                                    onClick={() => {
                                        navigator.clipboard.writeText(wallet.address);
                                        // Could add a toast notification here
                                    }}
                                    title="Copy to clipboard"
                                >
                                    📋
                                </button>
                            </div>
                            <p className="modal-hint">Share this address to receive funds</p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
