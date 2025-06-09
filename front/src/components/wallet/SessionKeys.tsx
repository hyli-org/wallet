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
    const [expirationDays, setExpirationDays] = useState("7");
    const [error, setError] = useState<unknown>(null);
    const [status, setStatus] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [transactionHash, setTransactionHash] = useState("");

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
            setTimeout(() => setStatus(""), 3000);
            setPassword("");
            await fetchSessionKeys();
        } catch (error) {
            setError(error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleRemoveKey = async (publicKey: string) => {
        setIsLoading(true);
        setError(null);
        setStatus("Removing session key...");
        setTransactionHash("");

        try {
            if (!password.length) {
                throw new Error("Please fill in your password");
            }

            const saltedPassword = await getSaltedPassword(password);
            await removeSessionKey(saltedPassword, publicKey, handleWalletEvent, handleError);

            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    webSocketService.unsubscribeFromWalletEvents();
                    reject(new Error("Operation timed out"));
                }, 30000);

                webSocketService.connect(wallet.address);
                const unsubscribe = webSocketService.subscribeToWalletEvents((wsEvent) => {
                    if (wsEvent.event === "Session key removed") {
                        localStorage.removeItem(publicKey);
                        clearTimeout(timeout);
                        unsubscribe();
                        webSocketService.disconnect();
                        resolve();
                    }
                });
            });

            setStatus("Session key removed successfully");
            setTimeout(() => setStatus(""), 3000);
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
                    <button onClick={handleAddKey} disabled={isLoading} className="add-key-button">
                        {isLoading ? "Adding..." : "Generate New Key"}
                    </button>
                </div>
            </div>

            {error !== null && <ErrorMessage error={error} />}
            {status && <div className="status-message">{status}</div>}
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
