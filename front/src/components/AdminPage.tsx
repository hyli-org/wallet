import React, { useState } from "react";
import { useWallet, verifyIdentity } from "hyli-wallet";
import { blob_builder, BlobTransaction } from "hyli";
import { check_secret } from "hyli-noir";
import { nodeService } from "../services/NodeService";
import { indexerService } from "../services/IndexerService";
import { BorshSchema, borshSerialize } from "borsher";
import { Buffer } from "buffer";

const deleteContractActionSchema = BorshSchema.Struct({
    contract_name: BorshSchema.String,
});

function serializeDeleteContractAction(contractName: string): Uint8Array {
    return borshSerialize(deleteContractActionSchema, {
        contract_name: contractName,
    });
}

const updateContractTimeoutWindowActionSchema = BorshSchema.Struct({
    contract_name: BorshSchema.String,
    timeout_window: BorshSchema.Enum({
        NoTimeout: BorshSchema.Unit,
        Timeout: BorshSchema.Struct({
            hard_timeout: BorshSchema.u64,
            soft_timeout: BorshSchema.u64,
        }),
    }),
});

function serializeUpdateContractTimeoutWindowAction(
    contractName: string,
    timeout_window: undefined | string | number,
): Uint8Array {
    let timeoutWindow;
    if (!timeout_window || !+timeout_window) {
        timeoutWindow = { NoTimeout: {} };
    } else {
        const timeout = BigInt(+timeout_window);
        timeoutWindow = {
            Timeout: {
                hard_timeout: timeout,
                soft_timeout: timeout,
            },
        };
    }
    return borshSerialize(updateContractTimeoutWindowActionSchema, {
        contract_name: contractName,
        timeout_window: timeoutWindow,
    });
}

const updateContractProgramIdActionSchema = BorshSchema.Struct({
    contract_name: BorshSchema.String,
    program_id: BorshSchema.Vec(BorshSchema.u8),
});

function serializeUpdateContractProgramIdAction(contractName: string, programId: string): Uint8Array {
    const programIdBytes = Array.from(new Uint8Array(Buffer.from(programId, "hex")));

    return borshSerialize(updateContractProgramIdActionSchema, {
        contract_name: contractName,
        program_id: programIdBytes,
    });
}

const INIT_TRANSFERS = [
    { to: "faucet", token: "oranj", amount: BigInt(1_000_000_000) },
    { to: "blackjack", token: "vitamin", amount: BigInt(1_000_000) },
    { to: "board_game", token: "oxygen", amount: BigInt(1_000_000_000) },
];

type AdminActionType = "delete" | "init" | "update" | "update_timeout";

type PendingAction = null | {
    type: AdminActionType;
    value: string;
    timeoutId: NodeJS.Timeout;
};

interface SectionCardProps {
    title: string;
    description?: string;
    maxWidth?: number | string;
    children: React.ReactNode;
}

const SectionCard: React.FC<SectionCardProps> = ({ title, description, maxWidth = "100%", children }) => (
    <section className="card" style={{ margin: "1.5rem 0", maxWidth, width: "100%" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div>
                <h3 className="card-title">{title}</h3>
                {description && <p style={{ color: "#888", marginTop: "0.25rem" }}>{description}</p>}
            </div>
            {children}
        </div>
    </section>
);

const ACTION_LABELS: Record<AdminActionType, string> = {
    init: "Init preconfigured transfers",
    delete: "Delete contract",
    update: "Update contract ProgramId",
    update_timeout: "Update contract timeout",
};

const AdminPage: React.FC = () => {
    const { wallet } = useWallet();
    const [status, setStatus] = useState<string>("");
    const [error, setError] = useState<string | null>(null);
    const [contractName, setContractName] = useState<string>("");
    const [_txHashes, _setTxHashes] = useState<string>("");
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [_result, setResult] = useState<string>("");
    const [pendingAction, setPendingAction] = useState<PendingAction>(null);
    const [password, setPassword] = useState<string>("");
    const [showPassword, setShowPassword] = useState<boolean>(false);
    const [pendingSeconds, setPendingSeconds] = useState<number>(5);
    const [updateContractName, setUpdateContractName] = useState<string>("");
    const [newProgramId, setNewProgramId] = useState<string>("");
    const [newTimeout, setNewTimeout] = useState<string>("");
    const [timeoutContractName, setTimeoutContractName] = useState<string>("");

    if (!wallet) return null;

    const isHyliAdmin = wallet.username === "hyli";

    // Helper to clear pending action
    const clearPending = () => {
        if (pendingAction) {
            clearTimeout(pendingAction.timeoutId);
            setPendingAction(null);
            setStatus("");
        }
    };

    // Generic admin action sender
    const sendAdminAction = async (actionType: AdminActionType, value?: string) => {
        setError(null);
        setIsLoading(true);
        try {
            const accountInfo = await indexerService.getAccountInfo(wallet.username);
            const salted_password = `${password}:${accountInfo.salt}`;
            const blob1 = verifyIdentity(wallet.username, Date.now());
            const identity = `${wallet.username}@${blob1.contract_name}`;
            const blob0 = await check_secret.build_blob(identity, salted_password);
            let blobs = [blob0, blob1];
            if (actionType === "init") {
                for (const t of INIT_TRANSFERS) {
                    blobs.push(blob_builder.smt_token.transfer(identity, t.to, t.token, t.amount, null));
                }
                setResult(
                    JSON.stringify(
                        INIT_TRANSFERS,
                        (_key, value) => (typeof value === "bigint" ? value.toString() : value),
                        2,
                    ),
                );
            } else if (actionType === "delete" && value) {
                const action = serializeDeleteContractAction(value);
                setResult(`DeleteContractAction: ${value}`);
                const actionBlob = { contract_name: "hyli", data: Array.from(action) };
                const deleteContractBlob = { contract_name: value, data: [] };
                blobs = [blob0, blob1, actionBlob, deleteContractBlob];
            } else if (actionType === "update") {
                const action = serializeUpdateContractProgramIdAction(updateContractName, newProgramId);
                setResult(`UpdateContractProgramIdAction: ${updateContractName} with new ProgramId: ${newProgramId}`);
                const actionBlob = { contract_name: "hyli", data: Array.from(action) };
                blobs = [blob0, blob1, actionBlob];
            } else if (actionType === "update_timeout") {
                const action = serializeUpdateContractTimeoutWindowAction(timeoutContractName, newTimeout);
                setResult(`UpdateContractTimeoutWindowAction: ${timeoutContractName} with new Timeout: ${newTimeout}`);
                const actionBlob = { contract_name: "hyli", data: Array.from(action) };
                blobs = [blob0, blob1, actionBlob];
            }
            setStatus(`Sending ${ACTION_LABELS[actionType]} transaction...`);
            const blobTx: BlobTransaction = { identity, blobs };
            const tx_hash = await nodeService.client.sendBlobTx(blobTx);
            setStatus("Building proof transaction...");
            const proofTx = await check_secret.build_proof_transaction(
                identity,
                salted_password,
                tx_hash,
                0,
                blobTx.blobs.length,
            );
            setStatus("Sending proof transaction...");
            await nodeService.client.sendProofTx(proofTx);
            setStatus(`${ACTION_LABELS[actionType]} transaction sent!`);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            setStatus("");
        } finally {
            setIsLoading(false);
        }
    };

    const handleInit = async () => {
        setError(null);
        setStatus("");
        setIsLoading(true);
        clearPending();
        const timeoutId = setTimeout(async () => {
            setPendingAction(null);
            await sendAdminAction("init");
        }, 5000);
        setPendingAction({ type: "init", value: "", timeoutId });
        setStatus(`Init will be sent in 5s. Click 'Undo' to cancel.`);
        setIsLoading(false);
    };

    const handleDeleteContract = async () => {
        setError(null);
        setStatus("");
        setIsLoading(true);
        // Only allow one pending action at a time
        clearPending();
        const timeoutId = setTimeout(async () => {
            setPendingAction(null);
            await sendAdminAction("delete", contractName);
        }, 5000);
        setPendingAction({ type: "delete", value: contractName, timeoutId });
        setStatus(`DeleteContract will be sent in 5s. Click 'Undo' to cancel.`);
        setIsLoading(false);
    };

    const handleUpdateContract = async () => {
        setError(null);
        setStatus("");
        setIsLoading(true);
        // Only allow one pending action at a time
        clearPending();
        const timeoutId = setTimeout(async () => {
            setPendingAction(null);
            await sendAdminAction("update");
        }, 5000);
        setPendingAction({ type: "update", value: updateContractName, timeoutId });
        setStatus(`UpdateContract will be sent in 5s. Click 'Undo' to cancel.`);
        setIsLoading(false);
    };

    const handleUpdateContractTimeout = async () => {
        setError(null);
        setStatus("");
        setIsLoading(true);
        // Only allow one pending action at a time
        clearPending();
        const timeoutId = setTimeout(async () => {
            setPendingAction(null);
            await sendAdminAction("update_timeout");
        }, 5000);
        setPendingAction({ type: "update_timeout", value: timeoutContractName, timeoutId });
        setStatus(`UpdateContract timeout will be sent in 5s. Click 'Undo' to cancel.`);
        setIsLoading(false);
    };

    React.useEffect(() => {
        if (!pendingAction) return;
        setPendingSeconds(5);
        const interval = setInterval(() => {
            setPendingSeconds((s) => {
                if (!pendingAction) return 5;
                if (s <= 1) {
                    clearInterval(interval);
                    return 0;
                }
                return s - 1;
            });
        }, 1000);
        return () => clearInterval(interval);
    }, [pendingAction]);

    const pendingCopy = pendingAction
        ? `${ACTION_LABELS[pendingAction.type]}${pendingAction.value ? ` (${pendingAction.value})` : ""} in ${pendingSeconds} second${pendingSeconds !== 1 ? "s" : ""}`
        : "";
    const hasFeedback = Boolean(status || pendingAction || error);

    return (
        <div
            style={{
                padding: 32,
                maxWidth: 1040,
                margin: "0 auto",
                display: "flex",
                flexDirection: "column",
                gap: "1.5rem",
            }}
        >
            <div>
                <h1>Admin Panel</h1>
                <p>Welcome, admin! Here you can perform special actions.</p>
            </div>

            {!isHyliAdmin && (
                <div
                    style={{
                        background: "#fff3cd",
                        border: "1px solid #ffeaa7",
                        color: "#856404",
                        padding: "1rem",
                        borderRadius: "0.5rem",
                    }}
                >
                    ⚠️ Limited access: Only the "hyli" user can use this admin section.
                </div>
            )}

            <div style={{ maxWidth: 420 }}>
                <label htmlFor="admin-password" style={{ display: "block", marginBottom: 8, color: "#8a92a6" }}>
                    Admin password
                </label>
                <div style={{ position: "relative" }}>
                    <input
                        id="admin-password"
                        className="input"
                        type={showPassword ? "text" : "password"}
                        placeholder="Enter your password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        style={{ width: "100%", paddingRight: 48 }}
                        disabled={!isHyliAdmin}
                    />
                    <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        style={{
                            position: "absolute",
                            right: 12,
                            top: "50%",
                            transform: "translateY(-50%)",
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            color: "#aaa",
                            fontSize: 18,
                        }}
                        tabIndex={-1}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                        {showPassword ? "🙈" : "👁️"}
                    </button>
                </div>
                <p style={{ fontSize: 13, color: "#6f7687", marginTop: 8 }}>
                    Required for every admin action. We never store this password.
                </p>
            </div>

            {hasFeedback && (
                <div style={{ position: "sticky", top: 16, zIndex: 30 }}>
                    <div
                        className="card"
                        style={{
                            padding: "1.25rem 1.5rem",
                            display: "flex",
                            flexWrap: "wrap",
                            gap: "1rem",
                            alignItems: "center",
                        }}
                    >
                        {status && (
                            <div style={{ color: "#9ab7ff", minWidth: 200 }}>
                                <strong style={{ display: "block", fontSize: 13, letterSpacing: 0.4 }}>Last statut</strong>
                                <span>{status}</span>
                            </div>
                        )}
                        {pendingAction && (
                            <div style={{ color: "#dfa445", minWidth: 220 }}>
                                <strong style={{ display: "block", fontSize: 13, letterSpacing: 0.4 }}>
                                    Pending Action
                                </strong>
                                <span>{pendingCopy}</span>
                                <button
                                    style={{
                                        marginLeft: 12,
                                        color: "#DFA445",
                                        textDecoration: "underline",
                                        background: "none",
                                        border: "none",
                                        cursor: "pointer",
                                        padding: 0,
                                    }}
                                    onClick={clearPending}
                                >
                                    Annuler
                                </button>
                            </div>
                        )}
                        {error && (
                            <div style={{ color: "#ff7b72", flex: "1 1 260px" }}>
                                <strong style={{ display: "block", fontSize: 13, letterSpacing: 0.4 }}>Erreur</strong>
                                <span>{String(error)}</span>
                            </div>
                        )}
                    </div>
                </div>
            )}

            <SectionCard
                title="Contract maintenance"
                description="Delete contracts, refresh their ProgramId, or tweak timeout windows from one place."
            >
                <div
                    style={{
                        display: "grid",
                        gap: "1.5rem",
                        gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                    }}
                >
                    <div
                        style={{
                            border: "1px solid #272a38",
                            borderRadius: 12,
                            padding: "1.25rem",
                            display: "flex",
                            flexDirection: "column",
                            gap: "0.75rem",
                        }}
                    >
                        <div>
                            <h4 style={{ margin: 0 }}>Delete a contract</h4>
                        </div>
                        <input
                            className="input"
                            type="text"
                            placeholder="Contract name"
                            value={contractName}
                            onChange={(e) => setContractName(e.target.value)}
                            disabled={!isHyliAdmin}
                        />
                        <button
                            className="btn-primary"
                            onClick={handleDeleteContract}
                            disabled={isLoading || !contractName || !password || !isHyliAdmin}
                        >
                            Delete contract
                        </button>
                    </div>

                    <div
                        style={{
                            border: "1px solid #272a38",
                            borderRadius: 12,
                            padding: "1.25rem",
                            display: "flex",
                            flexDirection: "column",
                            gap: "0.75rem",
                        }}
                    >
                        <div>
                            <h4 style={{ margin: 0 }}>Update ProgramId</h4>
                        </div>
                        <input
                            className="input"
                            type="text"
                            placeholder="Contract name"
                            value={updateContractName}
                            onChange={(e) => setUpdateContractName(e.target.value)}
                            disabled={!isHyliAdmin}
                        />
                        <input
                            className="input"
                            type="text"
                            placeholder="New ProgramId (hex)"
                            value={newProgramId}
                            onChange={(e) => setNewProgramId(e.target.value)}
                            disabled={!isHyliAdmin}
                        />
                        <button
                            className="btn-primary"
                            onClick={handleUpdateContract}
                            disabled={
                                isLoading || !updateContractName || !newProgramId || !password || !isHyliAdmin
                            }
                        >
                            Update ProgramId
                        </button>
                    </div>

                    <div
                        style={{
                            border: "1px solid #272a38",
                            borderRadius: 12,
                            padding: "1.25rem",
                            display: "flex",
                            flexDirection: "column",
                            gap: "0.75rem",
                        }}
                    >
                        <div>
                            <h4 style={{ margin: 0 }}>Update timeout</h4>
                        </div>
                        <input
                            className="input"
                            type="text"
                            placeholder="Contract name"
                            value={timeoutContractName}
                            onChange={(e) => setTimeoutContractName(e.target.value)}
                            disabled={!isHyliAdmin}
                        />
                        <input
                            className="input"
                            type="text"
                            placeholder="Timeout (seconds, 0 = none)"
                            value={newTimeout}
                            onChange={(e) => setNewTimeout(e.target.value)}
                            disabled={!isHyliAdmin}
                        />
                        <button
                            className="btn-primary"
                            onClick={handleUpdateContractTimeout}
                            disabled={
                                isLoading || !timeoutContractName || !newTimeout || !password || !isHyliAdmin
                            }
                        >
                            Update timeout
                        </button>
                    </div>
                </div>
            </SectionCard>

            <SectionCard
                title="Init preconfigured transfers"
                description="Bootstrap faucet and game contracts with the default balances."
            >
                <div style={{ display: "flex", flexWrap: "wrap", gap: "2rem" }}>
                    <div style={{ flex: "2 1 360px" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 16 }}>
                            <thead>
                                <tr style={{ borderBottom: "1px solid #2c2f3b", color: "#8a92a6" }}>
                                    <th style={{ textAlign: "left", padding: "8px" }}>Token</th>
                                    <th style={{ textAlign: "left", padding: "8px" }}>Amount</th>
                                    <th style={{ textAlign: "left", padding: "8px" }}>Recipient</th>
                                </tr>
                            </thead>
                            <tbody>
                                {INIT_TRANSFERS.map((t, i) => (
                                    <tr key={i} style={{ borderBottom: "1px solid #1f212b" }}>
                                        <td style={{ padding: "8px" }}>{t.token.toUpperCase()}</td>
                                        <td style={{ padding: "8px" }}>{t.amount.toString()}</td>
                                        <td style={{ padding: "8px" }}>{t.to}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div style={{ flex: "1 1 240px", display: "flex", flexDirection: "column", gap: "1rem" }}>
                        <p style={{ color: "#8a92a6", fontSize: 14 }}>
                            Use once per deployment to seed the recipients above. Action is delayed by 5 seconds to let you
                            cancel if needed.
                        </p>
                        <button
                            className="btn-primary"
                            style={{ minWidth: 220 }}
                            onClick={handleInit}
                            disabled={isLoading || !password || !isHyliAdmin}
                        >
                            Init transfers
                        </button>
                    </div>
                </div>
            </SectionCard>

        </div>
    );
};

export default AdminPage;
