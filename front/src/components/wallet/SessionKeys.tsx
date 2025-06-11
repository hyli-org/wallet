import { useState, useEffect } from "react";
import { useWallet, WalletEvent } from "hyli-wallet";
import { webSocketService } from "../../services/WebSocketService";
import { indexerService } from "../../services/IndexerService";
import { ErrorMessage } from "../ErrorMessage";
import "./SessionKeys.css";

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
    const [password, setPassword] = useState("");
    const [removePassword, setRemovePassword] = useState("");
    const [keyToRemove, setKeyToRemove] = useState<string | null>(null);
    const [showRemoveModal, setShowRemoveModal] = useState(false);
    const [expirationDays, setExpirationDays] = useState("7");
    const [error, setError] = useState<unknown>(null);
    const [status, setStatus] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [transactionHash, setTransactionHash] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [showRemovePassword, setShowRemovePassword] = useState(false);

    const fetchSessionKeys = async () => {
        try {
            const accountInfo = await indexerService.getAccountInfo(wallet.username);
            setSessionKeys(accountInfo.session_keys);
        } catch (error) {
            console.error("Failed to fetch session keys:", error);
            setError(new Error("Failed to load session keys"));
        }
    };

    useEffect(() => {
        fetchSessionKeys();
    }, [wallet.username]);

    const handleWalletEvent = (event: WalletEvent) => {
        // TODO: Make properly typed events
        const eventText = event.message;
        if (eventText.includes("Blob transaction sent:")) {
            const txHash = eventText.split(":")[1].trim();
            setStatus("Verifying identity...");
            setTransactionHash(txHash);
        } else if (eventText.includes("Proof transaction sent:")) {
            setStatus("Proof transaction sent, waiting for confirmation...");
        }
    };

    const handleError = (error: Error) => {
        setError(error);
    };

    const getSaltedPassword = async (password: string) => {
        const accountInfo = await indexerService.getAccountInfo(wallet.username);
        const salted_password = `${password}:${accountInfo.salt}`;
        return salted_password;
    };

    const handleAddKey = async () => {
        if (!password) {
            setError(new Error("Please enter your password"));
            return;
        }

        const days = parseInt(expirationDays);
        if (isNaN(days) || days <= 0) {
            setError(new Error("Please enter a valid expiration period"));
            return;
        }

        setIsLoading(true);
        setError(null);
        setStatus("Generating new session key...");
        setTransactionHash("");

        try {
            const expiration = Date.now() + days * 24 * 60 * 60 * 1000;
            if (!password.length) {
                throw new Error("Please fill in your password");
            }
            const saltedPassword = await getSaltedPassword(password);
            const { sessionKey } = await registerSessionKey(
                saltedPassword,
                expiration,
                ["oranj"],
                undefined,
                handleWalletEvent,
                handleError
            );

            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    webSocketService.unsubscribeFromWalletEvents();
                    reject(new Error("Operation timed out"));
                }, 30000);

                const unsubscribe = webSocketService.subscribeToWalletEvents((wsEvent) => {
                    if (wsEvent.event === "Session key added") {
                        localStorage.setItem(sessionKey.publicKey, sessionKey.privateKey);
                        clearTimeout(timeout);
                        unsubscribe();
                        resolve();
                    }
                });
            });

            setStatus("Session key added successfully");
            setPassword("");
            await fetchSessionKeys();
        } catch (error) {
            setError(error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleRemoveClick = (publicKey: string) => {
        setKeyToRemove(publicKey);
        setShowRemoveModal(true);
        setRemovePassword("");
        setError(null);
    };

    const handleRemoveKey = async () => {
        if (!keyToRemove) return;
        
        if (!removePassword) {
            setError(new Error("Please enter your password to remove this key"));
            return;
        }

        setIsLoading(true);
        setError(null);
        setStatus("Removing session key...");
        setTransactionHash("");

        try {
            const saltedPassword = await getSaltedPassword(removePassword);
            await removeSessionKey(saltedPassword, keyToRemove, handleWalletEvent, handleError);

            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    webSocketService.unsubscribeFromWalletEvents();
                    reject(new Error("Operation timed out"));
                }, 30000);

                webSocketService.connect(wallet.address);
                const unsubscribe = webSocketService.subscribeToWalletEvents((wsEvent) => {
                    if (wsEvent.event === "Session key removed") {
                        localStorage.removeItem(keyToRemove);
                        clearTimeout(timeout);
                        unsubscribe();
                        webSocketService.disconnect();
                        resolve();
                    }
                });
            });

            setStatus("Session key removed successfully");
            setShowRemoveModal(false);
            setRemovePassword("");
            setKeyToRemove(null);
            await fetchSessionKeys();
        } catch (error) {
            setError(error);
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
                        <div className="input-with-description" style={{ position: 'relative' }}>
                            <input
                                id="password"
                                type={showPassword ? "text" : "password"}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Enter your wallet password"
                                disabled={isLoading}
                                style={{ paddingRight: '3rem' }}
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                style={{
                                    position: 'absolute',
                                    right: '0.75rem',
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    background: 'transparent',
                                    border: 'none',
                                    color: 'var(--text-secondary)',
                                    cursor: 'pointer',
                                    padding: '0.5rem',
                                    fontSize: '1rem',
                                    lineHeight: '1',
                                    transition: 'color 0.2s ease'
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.color = 'var(--hyli-orange)'}
                                onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
                                title={showPassword ? "Hide password" : "Show password"}
                            >
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    {showPassword ? (
                                        <>
                                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                                            <line x1="1" y1="1" x2="23" y2="23" />
                                        </>
                                    ) : (
                                        <>
                                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                            <circle cx="12" cy="12" r="3" />
                                        </>
                                    )}
                                </svg>
                            </button>
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
                    <button onClick={handleAddKey} disabled={isLoading} className="btn-primary">
                        {isLoading ? "Adding..." : "Generate New Key"}
                    </button>
                </div>
            </div>

            {error !== null && <ErrorMessage error={error} />}
            {status && (
                <div className="status-message badge badge-primary">
                    {isLoading && <span className="spinner"></span>}
                    {status}
                </div>
            )}
            {transactionHash && (
                <div className="transaction-hash">
                    Transaction:&nbsp;
                    <code>
                        <a
                            href={`${import.meta.env.VITE_TX_EXPLORER_URL}/tx/${transactionHash}`}
                            target="_blank"
                            rel="noreferrer"
                        >
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
                                    <span className="key-nonce">Nonce: {key.nonce}</span>
                                </div>
                                <button
                                    onClick={() => handleRemoveClick(key.key)}
                                    disabled={isLoading}
                                    className="btn-secondary btn-sm"
                                >
                                    Remove
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {/* Remove Session Key Modal */}
            {showRemoveModal && (
                <div className="modal-overlay" onClick={() => setShowRemoveModal(false)}>
                    <div className="modal-content compact" onClick={(e) => e.stopPropagation()}>
                        <button className="modal-close" onClick={() => setShowRemoveModal(false)}>×</button>
                        <div className="modal-body">
                            <h3 className="modal-title">Remove Session Key</h3>
                            <p className="modal-description">Enter your password to remove this session key.</p>
                            
                            <div className="form-group">
                                <div style={{ position: 'relative' }}>
                                    <input
                                        type={showRemovePassword ? "text" : "password"}
                                        className="input"
                                        placeholder="Enter your password"
                                        value={removePassword}
                                        onChange={(e) => setRemovePassword(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                handleRemoveKey();
                                            }
                                        }}
                                        style={{ paddingRight: '3rem' }}
                                        autoFocus
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowRemovePassword(!showRemovePassword)}
                                        style={{
                                            position: 'absolute',
                                            right: '0.75rem',
                                            top: '50%',
                                            transform: 'translateY(-50%)',
                                            background: 'transparent',
                                            border: 'none',
                                            color: 'var(--text-secondary)',
                                            cursor: 'pointer',
                                            padding: '0.5rem',
                                            fontSize: '1rem',
                                            lineHeight: '1',
                                            transition: 'color 0.2s ease'
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.color = 'var(--hyli-orange)'}
                                        onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
                                        title={showRemovePassword ? "Hide password" : "Show password"}
                                    >
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            {showRemovePassword ? (
                                                <>
                                                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                                                    <line x1="1" y1="1" x2="23" y2="23" />
                                                </>
                                            ) : (
                                                <>
                                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                                    <circle cx="12" cy="12" r="3" />
                                                </>
                                            )}
                                        </svg>
                                    </button>
                                </div>
                            </div>

                            {error !== null && <ErrorMessage error={error} />}
                            
                            <div className="modal-actions">
                                <button 
                                    className="btn-secondary" 
                                    onClick={() => setShowRemoveModal(false)}
                                    disabled={isLoading}
                                >
                                    Cancel
                                </button>
                                <button 
                                    className="btn-primary" 
                                    onClick={handleRemoveKey}
                                    disabled={isLoading || !removePassword}
                                >
                                    {isLoading ? "Removing..." : "Remove Key"}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
