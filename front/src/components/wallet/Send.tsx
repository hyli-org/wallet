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

    const handleSend = async () => {
        setError(null);
        setStatus("Validating input...");
        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount) || parsedAmount <= 0) {
            setError(new Error("Please enter a valid amount"));
            return;
        }
        if (!address) {
            setError(new Error("Please enter a valid address"));
            return;
        }
        if (!password) {
            setError(new Error("Please enter your password"));
            return;
        }

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
                            setStatus("Transaction completed");
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
                console.error("Transaction error:", error);
                return;
            }

            onSend?.({
                type: "send",
                amount: parsedAmount,
                address,
                status: "completed",
            });

            setAmount("");
            setAddress("");
        } catch (error) {
            setError(error);
            setStatus("");
            console.error("Transaction error:", error);
            return;
        }
    };

    return (
        <div className="send-section">
            <div className="send-form">
                <h2>Send Funds</h2>
                <select value={contract} onChange={(e) => setContract(e.target.value)} style={{ marginBottom: 8 }}>
                    <option value="oranj">oranj</option>
                    <option value="oxygen">oxygen</option>
                    <option value="vitamin">vitamin</option>
                </select>
                <input type="number" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
                <input
                    type="text"
                    placeholder="Recipient Address (e.g. yourfriend@wallet)"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                />
                <input
                    type="password"
                    placeholder="Enter your password"
                    onChange={(e) => setPassword(e.target.value)}
                />
                {error !== null && <ErrorMessage error={error} />}
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
