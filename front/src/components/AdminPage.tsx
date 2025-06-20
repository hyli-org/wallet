import React, { useState } from "react";
import { useWallet, verifyIdentity } from "hyli-wallet";
import { blob_builder, BlobTransaction } from "hyli";
import { build_proof_transaction, build_blob as check_secret_blob } from "hyli-check-secret";
import { nodeService } from "../services/NodeService";
import { indexerService } from "../services/IndexerService";
import { BorshSchema, borshSerialize } from "borsher";
import { Buffer } from "buffer";

const as_structured = (schema: BorshSchema<any>) => {
    return BorshSchema.Struct({
        caller: BorshSchema.Option(BorshSchema.u64),
        callees: BorshSchema.Option(BorshSchema.Vec(BorshSchema.u64)),
        parameters: schema,
    });
};

const deleteContractActionSchema = as_structured(
    BorshSchema.Struct({
        contract_name: BorshSchema.String,
    })
);

function serializeDeleteContractAction(contractName: string): Uint8Array {
    return borshSerialize(deleteContractActionSchema, {
        parameters: { contract_name: contractName },
        caller: null,
        callees: null,
    });
}

const upgradeContractTimeoutActionSchema = as_structured(
    BorshSchema.Struct({
        contract_name: BorshSchema.String,
        timeout_window: BorshSchema.Enum({
            NoTimeout: BorshSchema.Unit,
            Timeout: BorshSchema.u64,
        }),
    })
);

function serializeUpgradeContractTimeoutAction(
    contractName: string,
    timeout_window: undefined | string | number
): Uint8Array {
    let timeoutWindow;
    if (!timeout_window || !+timeout_window) {
        timeoutWindow = { NoTimeout: {} };
    } else {
        timeoutWindow = { Timeout: +timeout_window };
    }
    return borshSerialize(upgradeContractTimeoutActionSchema, {
        parameters: { contract_name: contractName, timeout_window: timeoutWindow },
        caller: null,
        callees: null,
    });
}

const nukeTxActionSchema = as_structured(
    BorshSchema.Struct({
        tx_hashes: BorshSchema.Vec(BorshSchema.String),
    })
);

function serializeNukeTxAction(txHashes: string[]): Uint8Array {
    return borshSerialize(nukeTxActionSchema, { parameters: { tx_hashes: txHashes }, caller: null, callees: null });
}

const updateContractProgramIdActionSchema = as_structured(
    BorshSchema.Struct({
        contract_name: BorshSchema.String,
        program_id: BorshSchema.Vec(BorshSchema.u8),
    })
);

function serializeUpdateContractProgramIdAction(contractName: string, programId: string): Uint8Array {
    const programIdBytes = Array.from(new Uint8Array(Buffer.from(programId, "hex")));

    return borshSerialize(updateContractProgramIdActionSchema, {
        parameters: {
            contract_name: contractName,
            program_id: programIdBytes,
        },
        caller: null,
        callees: null,
    });
}

const INIT_TRANSFERS = [
    { to: "faucet", token: "oranj", amount: BigInt(1_000_000_000) },
    { to: "blackjack", token: "vitamin", amount: BigInt(1_000_000) },
    { to: "board_game", token: "oxygen", amount: BigInt(1_000_000_000) },
];

type PendingAction = null | {
    type: "delete" | "nuke" | "init" | "update" | "update_timeout";
    value: string;
    timeoutId: NodeJS.Timeout;
};

const AdminPage: React.FC = () => {
    const { wallet } = useWallet();
    const [status, setStatus] = useState<string>("");
    const [error, setError] = useState<unknown>(null);
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
    const sendAdminAction = async (
        actionType: "init" | "delete" | "nuke" | "update" | "update_timeout",
        value?: string
    ) => {
        setError(null);
        setIsLoading(true);
        try {
            const accountInfo = await indexerService.getAccountInfo(wallet.username);
            const salted_password = `${password}:${accountInfo.salt}`;
            const blob1 = verifyIdentity(wallet.username, Date.now());
            const identity = `${wallet.username}@${blob1.contract_name}`;
            const blob0 = await check_secret_blob(identity, salted_password);
            let blobs = [blob0, blob1];
            if (actionType === "init") {
                for (const t of INIT_TRANSFERS) {
                    blobs.push(blob_builder.smt_token.transfer(identity, t.to, t.token, t.amount, null));
                }
                setResult(
                    JSON.stringify(
                        INIT_TRANSFERS,
                        (_key, value) => (typeof value === "bigint" ? value.toString() : value),
                        2
                    )
                );
            } else if (actionType === "delete" && value) {
                const action = serializeDeleteContractAction(value);
                setResult(`DeleteContractAction: ${value}`);
                const actionBlob = { contract_name: "hyle", data: Array.from(action) };
                blobs = [blob0, blob1, actionBlob];
            } else if (actionType === "nuke" && value) {
                const hashes = value
                    .split(",")
                    .map((h) => h.trim())
                    .filter(Boolean);
                const action = serializeNukeTxAction(hashes);
                setResult(`NukeTxAction: ${hashes.join(", ")}`);
                const actionBlob = { contract_name: "hyle", data: Array.from(action) };
                blobs = [actionBlob];
            } else if (actionType === "update") {
                const action = serializeUpdateContractProgramIdAction(updateContractName, newProgramId);
                setResult(`UpdateContractProgramIdAction: ${updateContractName} with new ProgramId: ${newProgramId}`);
                const actionBlob = { contract_name: "hyle", data: Array.from(action) };
                blobs = [blob0, actionBlob, blob1];
            } else if (actionType === "update_timeout") {
                const action = serializeUpgradeContractTimeoutAction(updateContractName, newTimeout);
                setResult(`UpgradeContractTimeoutAction: ${updateContractName} with new Timeout: ${newTimeout}`);
                const actionBlob = { contract_name: "hyle", data: Array.from(action) };
                blobs = [blob0, actionBlob, blob1];
            }
            const actionTypeLabels: Record<typeof actionType, string> = {
                init: "Init",
                delete: "DeleteContract",
                nuke: "NukeTx",
                update: "UpdateContract",
                update_timeout: "UpdateContractTimeout",
            };
            setStatus(`Sending ${actionTypeLabels[actionType]} transaction...`);
            const blobTx: BlobTransaction = { identity, blobs };
            const tx_hash = await nodeService.client.sendBlobTx(blobTx);
            setStatus("Building proof transaction...");
            const proofTx = await build_proof_transaction(identity, salted_password, tx_hash, 0, blobTx.blobs.length);
            setStatus("Sending proof transaction...");
            await nodeService.client.sendProofTx(proofTx);
            const sentLabels: Record<typeof actionType, string> = {
                init: "Init",
                delete: "DeleteContract",
                nuke: "NukeTx",
                update: "UpdateContract",
                update_timeout: "UpdateContractTimeout",
            };
            setStatus(`${sentLabels[actionType]} transaction sent!`);
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
        setPendingAction({ type: "update_timeout", value: updateContractName, timeoutId });
        setStatus(`UpdateContract will be sent in 5s. Click 'Undo' to cancel.`);
        setIsLoading(false);
    };
    /*
    const handleNukeTx = async () => {
        setError(null);
        setStatus("");
        setIsLoading(true);
        // Only allow one pending action at a time
        clearPending();
        const timeoutId = setTimeout(async () => {
            setPendingAction(null);
            await sendAdminAction("nuke", txHashes);
        }, 5000);
        setPendingAction({ type: "nuke", value: txHashes, timeoutId });
        setStatus(`NukeTx will be sent in 5s. Click 'Undo' to cancel.`);
        setIsLoading(false);
    };*/

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

    return (
        <div style={{ padding: 32 }}>
            <h1>Admin Panel</h1>
            <p>Welcome, admin! Here you can perform special actions.</p>

            {!isHyliAdmin && (
                <div
                    style={{
                        background: "#fff3cd",
                        border: "1px solid #ffeaa7",
                        color: "#856404",
                        padding: "1rem",
                        borderRadius: "0.5rem",
                        marginBottom: "2rem",
                    }}
                >
                    ⚠️ Limited access: Only the "hyli" user can use this admin section.
                </div>
            )}
            <div className="card" style={{ margin: "2rem 0", maxWidth: 600 }}>
                <h3 className="card-title">Init Payload</h3>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 16 }}>
                    <thead>
                        <tr style={{ borderBottom: "1px solid #eee" }}>
                            <th style={{ textAlign: "left", padding: "8px" }}>Token</th>
                            <th style={{ textAlign: "left", padding: "8px" }}>Amount</th>
                            <th style={{ textAlign: "left", padding: "8px" }}>Recipient</th>
                        </tr>
                    </thead>
                    <tbody>
                        {INIT_TRANSFERS.map((t, i) => (
                            <tr key={i} style={{ borderBottom: "1px solid #f5f5f5" }}>
                                <td style={{ padding: "8px" }}>{t.token.toUpperCase()}</td>
                                <td style={{ padding: "8px" }}>{t.amount.toString()}</td>
                                <td style={{ padding: "8px" }}>{t.to}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div style={{ flex: 1, maxWidth: 320, marginBottom: 32 }}>
                <input
                    className="input"
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    style={{ width: "100%" }}
                    disabled={!isHyliAdmin}
                />
                <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    style={{
                        position: "absolute",
                        right: 10,
                        top: 10,
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "#aaa",
                    }}
                    tabIndex={-1}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                >
                    {showPassword ? "🙈" : "👁️"}
                </button>
            </div>
            <div className="form-group" style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
                <button
                    className="btn-primary"
                    style={{ minWidth: 180 }}
                    onClick={handleInit}
                    disabled={isLoading || !password || !isHyliAdmin}
                >
                    Init (preconfigured transfers)
                </button>
            </div>
            <div className="form-group" style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
                <input
                    className="input"
                    type="text"
                    placeholder="Contract name to delete"
                    value={contractName}
                    onChange={(e) => setContractName(e.target.value)}
                    style={{ maxWidth: 320 }}
                    disabled={!isHyliAdmin}
                />
                <button
                    className="btn-primary"
                    style={{ minWidth: 180 }}
                    onClick={handleDeleteContract}
                    disabled={isLoading || !contractName || !password || !isHyliAdmin}
                >
                    Delete Contract
                </button>
            </div>

            <div className="card" style={{ margin: "2rem 0", maxWidth: 800 }}>
                <h3 className="card-title">Update Contract</h3>
                <p style={{ color: "#666", marginBottom: "1rem" }}>
                    Update a contract by deleting it and then registering it with a new ProgramId. The verifier and
                    commitment will be automatically retrieved from the existing contract.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                    <div className="form-group" style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
                        <input
                            className="input"
                            type="text"
                            placeholder="Contract name to update"
                            value={updateContractName}
                            onChange={(e) => setUpdateContractName(e.target.value)}
                            style={{ flex: 1, maxWidth: 320 }}
                            disabled={!isHyliAdmin}
                        />
                    </div>
                    <div className="form-group" style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
                        <input
                            className="input"
                            type="text"
                            placeholder="New ProgramId (hex)"
                            value={newProgramId}
                            onChange={(e) => setNewProgramId(e.target.value)}
                            style={{ flex: 1, maxWidth: 600 }}
                            disabled={!isHyliAdmin}
                        />
                    </div>
                    <div className="form-group" style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
                        <button
                            className="btn-primary"
                            style={{ minWidth: 180 }}
                            onClick={handleUpdateContract}
                            disabled={isLoading || !updateContractName || !newProgramId || !password || !isHyliAdmin}
                        >
                            Update Contract
                        </button>
                    </div>
                </div>
            </div>

            <div className="card" style={{ margin: "2rem 0", maxWidth: 800 }}>
                <h3 className="card-title">Update Contract Timeout</h3>
                <p style={{ color: "#666", marginBottom: "1rem" }}>
                    Update a contract timeout. 0 will mean "no timeout".
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                    <div className="form-group" style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
                        <input
                            className="input"
                            type="text"
                            placeholder="Contract name to update"
                            value={updateContractName}
                            onChange={(e) => setUpdateContractName(e.target.value)}
                            style={{ flex: 1, maxWidth: 320 }}
                            disabled={!isHyliAdmin}
                        />
                    </div>
                    <div className="form-group" style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
                        <input
                            className="input"
                            type="text"
                            placeholder="New Timeout (0 for 'no timeout')"
                            value={newTimeout}
                            onChange={(e) => setNewTimeout(e.target.value)}
                            style={{ flex: 1, maxWidth: 400 }}
                            disabled={!isHyliAdmin}
                        />
                    </div>
                    <div className="form-group" style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
                        <button
                            className="btn-primary"
                            style={{ minWidth: 180 }}
                            onClick={handleUpdateContractTimeout}
                            disabled={isLoading || !updateContractName || !newTimeout || !password || !isHyliAdmin}
                        >
                            Update Contract Timeout
                        </button>
                    </div>
                </div>
            </div>

            {/*
            <div className="form-group" style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                <input
                    className="input"
                    type="text"
                    placeholder="Comma-separated TX hashes to nuke"
                    value={txHashes}
                    onChange={(e) => setTxHashes(e.target.value)}
                    style={{ maxWidth: 320 }}
                />
                <button className="btn-primary" style={{ minWidth: 180 }} onClick={handleNukeTx} disabled={isLoading || !txHashes || !password}>
                    Nuke TX
                </button>
            </div>
            */}
            {status && <div>Status: {status}</div>}
            {pendingAction && (
                <div style={{ margin: "1rem 0", color: "#DFA445", fontWeight: 500 }}>
                    Action will be sent in {pendingSeconds} second{pendingSeconds !== 1 ? "s" : ""}.{" "}
                    <button
                        style={{
                            color: "#DFA445",
                            textDecoration: "underline",
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                        }}
                        onClick={clearPending}
                    >
                        Undo
                    </button>
                </div>
            )}
            {error ? <div style={{ color: "red" }}>Error: {String(error)}</div> : null}
        </div>
    );
};

export default AdminPage;
