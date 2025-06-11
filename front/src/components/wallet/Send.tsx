import { useState } from "react";
import { verifyIdentity, Wallet } from "hyli-wallet";
import { blob_builder, BlobTransaction } from "hyli";
import { build_proof_transaction, build_blob as check_secret_blob } from "hyli-check-secret";
import { nodeService } from "../../services/NodeService";
import { Transaction, webSocketService } from "../../services/WebSocketService";
import { ErrorMessage } from "../ErrorMessage";
import { indexerService } from "../../services/IndexerService";

interface SendProps {
    onSend?: (transaction: Omit<Transaction, "id" | "timestamp">) => void;
    wallet: Wallet;
}

export const Send = ({ wallet, onSend }: SendProps) => {
    const [amount, setAmount] = useState<string>("");
    const [address, setAddress] = useState<string>("");
    const [password, setPassword] = useState<string>("password123");
    const [contract, setContract] = useState<string>("oranj");
    const [error, setError] = useState<unknown>(null);
    const [status, setStatus] = useState<string>("");
    const [transactionHash, setTransactionHash] = useState<string>("");
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [showPassword, setShowPassword] = useState<boolean>(false);

    const handleSend = async () => {
        setError(null);

        // Validate inputs first without showing loading state
        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount) || parsedAmount <= 0) {
            setError(new Error("Please enter a valid amount"));
            return;
        }
        if (!address) {
            setError(new Error("Please enter a valid address"));
            return;
        }

        // Remove mandatory @wallet validation - proceed with transaction
        if (!password) {
            setError(new Error("Please enter your password"));
            return;
        }

        // Only show loading state after validation passes
        setStatus("Validating input...");
        setIsLoading(true);

        const accountInfo = await indexerService.getAccountInfo(wallet.username);
        const salted_password = `${password}:${accountInfo.salt}`;

        const blob1 = verifyIdentity(wallet.username, Date.now());
        const identity = `${wallet.username}@${blob1.contract_name}`;
        const blob0 = await check_secret_blob(identity, salted_password);

        const blob2 = blob_builder.smt_token.transfer(identity, address, contract, BigInt(parsedAmount), null);

        const blobTx: BlobTransaction = {
            identity,
            blobs: [blob0, blob1, blob2],
        };

        try {
            setStatus("Verifying identity...");
            const tx_hash = await nodeService.client.sendBlobTx(blobTx);
            setTransactionHash(tx_hash);
            setStatus("Building proof transaction (this may take a few moments)...");
            const proofTx = await build_proof_transaction(identity, salted_password, tx_hash, 0, blobTx.blobs.length);
            setStatus("Sending proof transaction...");
            await nodeService.client.sendProofTx(proofTx);
            setStatus("Waiting for transaction confirmation...");

            try {
                await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        unsubscribeTxEvents();
                        reject(new Error("Transaction timed out"));
                    }, 30000);

                    const unsubscribeTxEvents = webSocketService.subscribeToTxEvents((event) => {
                        console.log("Received tx event:", event);
                        if (event.tx.id === tx_hash && event.tx.status === "Success") {
                            setStatus("Transaction completed successfully");
                            clearTimeout(timeout);
                            unsubscribeTxEvents();
                            resolve(event);
                        } else if (event.tx.id === tx_hash && event.tx.status != "Sequenced") {
                            clearTimeout(timeout);
                            unsubscribeTxEvents();
                            reject(new Error("Transaction failed: " + event.tx.status));
                        }
                    });
                });
            } catch (error) {
                setError(error);
                setStatus("");
                setIsLoading(false);
                console.error("Transaction error:", error);
                return;
            }

            onSend?.({
                type: "Send",
                amount: parsedAmount,
                address,
                status: "Success",
            });

            setAmount("");
            setAddress("");
        } catch (error) {
            setError(error);
            setStatus("");
            setIsLoading(false);
            console.error("Transaction error:", error);
            return;
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="send-section">
            <div className="send-form card">
                <h2 className="card-title">Send Funds</h2>

                <div className="form-group">
                    <label className="form-label">Select Token</label>
                    <div className="select-wrapper">
                        <select className="input select" value={contract} onChange={(e) => setContract(e.target.value)}>
                            <option value="oranj">ORANJ</option>
                            <option value="oxygen">OXYGEN</option>
                            <option value="vitamin">VITAMIN</option>
                        </select>
                        <span className="select-icon">▼</span>
                    </div>
                </div>

                <div className="form-group">
                    <label className="form-label">Amount</label>
                    <input
                        className="input"
                        type="number"
                        placeholder="0.00"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                    />
                </div>

                <div className="form-group" style={{ gap: "2px", marginBottom: "10px" }}>
                    <label className="form-label">Recipient Address</label>
                    <input
                        className="input"
                        type="text"
                        placeholder="username@wallet"
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                    />
                    <p
                        style={{
                            textAlign: "center",
                            width: "100%",
                            fontSize: "var(--text-sm)",
                            color: "var(--text-secondary)",
                            fontStyle: "italic",
                        }}
                    >
                        Enter the recipient's wallet address
                    </p>
                    {address && !address.endsWith("@wallet") && (
                        <div
                            className="form-warning"
                            style={{
                                background: "rgba(223, 164, 69, 0.1)",
                                border: "1px solid rgba(223, 164, 69, 0.3)",
                                borderRadius: "12px",
                                padding: "1rem",
                                marginTop: "0.75rem",
                                display: "flex",
                                alignItems: "flex-start",
                                gap: "0.75rem",
                                backdropFilter: "blur(8px)",
                            }}
                        >
                            <span
                                style={{
                                    color: "#DFA445",
                                    fontSize: "1.25rem",
                                    lineHeight: "1",
                                }}
                            >
                                ⚠
                            </span>
                            <div
                                style={{
                                    flex: 1,
                                    fontFamily: "var(--font-body)",
                                    fontSize: "var(--text-sm)",
                                    color: "#DFA445",
                                    lineHeight: "1.5",
                                }}
                            >
                                <strong style={{ fontWeight: "var(--font-semibold)" }}>
                                    Non-standard address format
                                </strong>
                                <br />
                                Address doesn't end with @wallet. Please verify this is the correct recipient.
                            </div>
                        </div>
                    )}
                </div>

                <div className="form-group">
                    <label className="form-label">Password</label>
                    <div className="password-wrapper" style={{ position: "relative" }}>
                        <input
                            className="input"
                            type={showPassword ? "text" : "password"}
                            placeholder="Enter your password"
                            onChange={(e) => setPassword(e.target.value)}
                            style={{ paddingRight: "3rem" }}
                        />
                        <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            style={{
                                position: "absolute",
                                right: "0.75rem",
                                top: "50%",
                                transform: "translateY(-50%)",
                                background: "transparent",
                                border: "none",
                                color: "var(--text-secondary)",
                                cursor: "pointer",
                                padding: "0.5rem",
                                fontSize: "1rem",
                                lineHeight: "1",
                                transition: "color 0.2s ease",
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--hyli-orange)")}
                            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-secondary)")}
                            title={showPassword ? "Hide password" : "Show password"}
                        >
                            <svg
                                width="20"
                                height="20"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                            >
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
                            <a href={`${import.meta.env.VITE_TX_EXPLORER_URL}/tx/${transactionHash}`} target="_blank">
                                {`${transactionHash.slice(0, 10)}...${transactionHash.slice(-10)}`}
                            </a>
                        </code>
                    </div>
                )}

                <button className="btn-primary btn-block" onClick={handleSend} disabled={isLoading}>
                    {isLoading ? (
                        <>
                            <span className="spinner"></span>
                            Sending...
                        </>
                    ) : (
                        "Send"
                    )}
                </button>
            </div>
        </div>
    );
};
