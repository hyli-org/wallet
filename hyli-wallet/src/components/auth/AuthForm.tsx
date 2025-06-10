import React, { useState, useEffect } from "react";
import { AuthCredentials, AuthProvider } from "../../providers/BaseAuthProvider";
import { ProviderOption, useWalletInternal } from "../../hooks/useWallet";
import { RegistrationStage, WalletErrorCallback, WalletEvent, WalletEventCallback } from "../../types/wallet";
import { getAuthErrorMessage } from "../../utils/errorMessages";
import "./AuthForm.css";
import { PasswordAuthCredentials } from "../../providers/PasswordAuthProvider";

type AuthStage =
    | "idle" // Initial state, no authentication in progress
    | RegistrationStage
    | "generating_proof" // Generating proof of password
    | "logged_in"
    | "error"; // An error occurred during authentication

interface AuthFormProps {
    provider: AuthProvider;
    mode: "login" | "register";
    /**
     * CSS class prefix for styling overrides. Default is 'hyli'
     */
    classPrefix?: string;
    /**
     * Call to close the modal after successful login or registration.
     */
    closeModal?: () => void;
    /**
     * Controls session key checkbox behavior:
     *  - true: force session key ON (checked, cannot change)
     *  - false: force session key OFF (do not show checkbox)
     *  - undefined: allow user to toggle checkbox
     */
    forceSessionKey?: boolean;

    /**
     * Use to prevent closing the modal while registering / logging in.
     */
    setLockOpen?: (lockOpen: boolean) => void;
}

const ZK_FUN_FACTS = [
    "ZKPs were invented in 1989 by Shafi Goldwasser, Silvio Micali, and Charles Rackoff.",
    "Zero-knowledge proofs are critical for privacy in blockchain and cryptocurrencies.",
    "You can prove you’re over 18 with a ZKP, without telling anyone your actual birthdate.",
    "ZKPs power privacy coins like Zcash, hiding transaction details from everyone except participants.",
    "zk-SNARKs (“succinct non-interactive arguments of knowledge”) are one of the most popular ZKP types.",
    "In 2022, Ethereum’s Vitalik Buterin called ZKPs “the future of Ethereum scaling.”",
    "Noir is the programming language we use for these client-side proofs.",
    "Reticulating splines.",
    "ZKPs are used for secure voting, to let people prove they voted (and voted once) without revealing who they voted for.",
    "ZKPs are pure math: no AI or machine learning involved, just logic and cryptography.",
    "The security of many ZKP systems relies on the hardness of mathematical problems, like factoring big numbers.",
    "Zero-knowledge proofs can be recursive: proving you proved something, without redoing the whole proof.",
    "The “zero-knowledge” part doesn’t mean “no information”. It means “no extra information.”",
    "How many times can you recursively prove you proved something?",
    "We’re composing proofs across the galaxy. Mars vibes only.",
    "ZK lets us check everything without seeing anything. No peeking!",
    "RISC Zero, SP1, Noir? We support them all. And more soon.",
    "Please stand by while Hyli makes blockchain less boring.",
    "Generating proof of vibes.",
];

function getRandomFact() {
    return ZK_FUN_FACTS[Math.floor(Math.random() * ZK_FUN_FACTS.length)];
}

function getRandomSalt() {
    return Math.random().toString(36).substring(2, 20);
}

export const AuthForm: React.FC<AuthFormProps> = ({
    provider,
    mode,
    classPrefix = "hyli",
    closeModal,
    forceSessionKey,
    setLockOpen,
}) => {
    const { login, registerAccount: registerWallet, sessionKeyConfig, onWalletEvent, onError } = useWalletInternal();
    const isLocalhost =
        typeof window !== "undefined" &&
        (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
    const [credentials, setCredentials] = useState<PasswordAuthCredentials & { inviteCode: string }>({
        username: isLocalhost ? "bob" : "",
        password: isLocalhost ? "hylisecure" : "",
        confirmPassword: isLocalhost ? "hylisecure" : "",
        inviteCode: isLocalhost ? "vip" : "",
        salt: getRandomSalt(),
    });
    const [error, setError] = useState<string>("");
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
    const [stage, setStage] = useState<AuthStage>("idle");
    // Session key checkbox state logic
    const [autoSessionKey, setAutoSessionKey] = useState<boolean>(forceSessionKey === true ? true : true);
    const [funFact, setFunFact] = useState<string>(getRandomFact());

    // If forceSessionKey changes, update autoSessionKey accordingly
    useEffect(() => {
        if (forceSessionKey === true) setAutoSessionKey(true);
        if (forceSessionKey === false) setAutoSessionKey(false);
    }, [forceSessionKey]);

    useEffect(() => {
        if (stage === "logged_in" && closeModal) {
            const timer = setTimeout(() => {
                closeModal();
            }, 2000);
            return () => clearTimeout(timer);
        }
    }, [stage, closeModal]);

    useEffect(() => {
        let timer: NodeJS.Timeout | undefined;
        if (isSubmitting) {
            setFunFact(getRandomFact());
            timer = setInterval(() => {
                setFunFact(getRandomFact());
            }, 2000);
        }
        return () => {
            if (timer) clearInterval(timer);
        };
    }, [isSubmitting]);

    const deriveStatusMessage = (stage: AuthStage): string => {
        switch (stage) {
            case "sending_blob":
                return "Sending transaction...";
            case "generating_proof":
                return "Generating client-side ZK proof of password...";
            case "sending_proof":
                return "Sending proof of password...";
            case "proof_sent":
                return "Waiting for transaction confirmation...";
            case "logged_in":
                return "Logged on successfully!";
            case "error":
                return "Error occurred";
            default:
                return "";
        }
    };

    const statusMessage = deriveStatusMessage(stage);

    const onWalletEventWithStage = (event: WalletEvent) => {
        if (event.message) {
            if (event.type === "custom" && event.message.includes("Generating proof of password")) {
                setStage("generating_proof");
            } else if (["sending_proof", "proof_sent", "logged_in"].includes(event.type)) {
                setStage(event.type as AuthStage);
            }
        }
        if (onWalletEvent) onWalletEvent(event);
    };
    const onErrorWithStage = (err: Error) => {
        console.error("AuthForm error:", err);
        const errorDetails = getAuthErrorMessage(err);
        setError(errorDetails.userMessage);
        setStage("idle");
        setIsSubmitting(false);
        if (onError) onError(err);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");

        // Validate required fields
        if (!credentials.username || !credentials.password) {
            setError("Please fill in all fields");
            return;
        }
        // Password length validation for both login and register
        if (credentials.password.length < 8) {
            setError("Password must be at least 8 characters long");
            return;
        }
        // Password match check for registration
        if (mode === "register" && credentials.password !== credentials.confirmPassword) {
            setError("Passwords do not match.");
            return;
        }
        // Invite code required for registration
        if (mode === "register" && !credentials.inviteCode) {
            setError("Invite code is required.");
            return;
        }
        setIsSubmitting(true);
        setStage("sending_blob");
        const authAction = async (
            provider: ProviderOption,
            credentials: PasswordAuthCredentials & { inviteCode: string }
        ) => {
            if (mode === "login") {
                await login(provider, credentials, onWalletEventWithStage, onErrorWithStage, {
                    registerSessionKey: autoSessionKey,
                });
            } else if (mode === "register") {
                await registerWallet(provider, credentials, onWalletEventWithStage, onErrorWithStage, {
                    registerSessionKey: autoSessionKey,
                });
            }
        };
        try {
            setLockOpen?.(true);
            await authAction(provider.type as ProviderOption, credentials);
        } catch (err) {
            const errorDetails = getAuthErrorMessage(err as Error);
            setError(errorDetails.userMessage);
            setStage("idle");
            setIsSubmitting(false);
        } finally {
            setLockOpen?.(false);
            setIsSubmitting(false);
        }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setCredentials((prev) => ({
            ...prev,
            [name]: value,
        }));
    };

    return (
        <div className={`${classPrefix}-auth-form-container`} style={{ position: "relative" }}>
            {/* Loading Modal-Within-Modal */}
            {["sending_blob", "generating_proof", "sending_proof", "proof_sent"].includes(stage) && (
                <div className={`${classPrefix}-loading-modal-overlay`}>
                    <div style={{ marginBottom: 24 }}>
                        <div
                            className={`${classPrefix}-spinner`}
                            style={{
                                border: "4px solid #eee",
                                borderTop: `4px solid #0077ff`,
                                borderRadius: "50%",
                                width: 48,
                                height: 48,
                                animation: "spin 1s linear infinite",
                                margin: "0 auto 16px auto",
                            }}
                        />
                        <div style={{ textAlign: "center", fontWeight: 600, fontSize: 18, marginBottom: 8 }}>
                            {statusMessage || "Processing..."}
                        </div>
                        <div style={{ textAlign: "center", color: "#666", fontSize: 14, marginBottom: 8 }}>
                            Please wait while we work our ZK magic...
                        </div>
                    </div>
                    <div className={`${classPrefix}-zk-fun-fact`}>
                        <span role="img" aria-label="lightbulb" style={{ marginRight: 6 }}>
                            💡
                        </span>
                        {funFact}
                    </div>
                </div>
            )}
            {stage === "logged_in" ? (
                <div
                    className={`${classPrefix}-success-message`}
                    style={{ textAlign: "center", padding: 32 }}
                    onClick={closeModal}
                >
                    <div style={{ fontSize: 48, color: "#4BB543", marginBottom: 16 }}>✓</div>
                    <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Login successful!</div>
                    <div style={{ color: "#666", marginBottom: 16 }}>You are now logged in. Redirecting...</div>
                </div>
            ) : (
                <form onSubmit={handleSubmit} className={`${classPrefix}-auth-form`}>
                    <div className={`${classPrefix}-form-group`}>
                        <label htmlFor="username" className={`${classPrefix}-form-label`}>
                            Username
                        </label>
                        <input
                            id="username"
                            name="username"
                            type="text"
                            value={credentials.username}
                            onChange={handleInputChange}
                            placeholder="Enter your username"
                            disabled={isSubmitting}
                            className={`${classPrefix}-form-input`}
                        />
                    </div>

                    <div className={`${classPrefix}-form-group`}>
                        <label htmlFor="password" className={`${classPrefix}-form-label`}>
                            Password
                        </label>
                        <input
                            id="password"
                            name="password"
                            type="password"
                            value={credentials.password}
                            onChange={handleInputChange}
                            placeholder="Enter your password (min. 8 characters)"
                            disabled={isSubmitting}
                            className={`${classPrefix}-form-input`}
                        />
                    </div>

                    {mode === "register" && (
                        <>
                            <div className={`${classPrefix}-form-group`}>
                                <label htmlFor="confirmPassword" className={`${classPrefix}-form-label`}>
                                    Confirm Password
                                </label>
                                <input
                                    id="confirmPassword"
                                    name="confirmPassword"
                                    type="password"
                                    value={credentials.confirmPassword}
                                    onChange={handleInputChange}
                                    placeholder="Confirm your password (min. 8 characters)"
                                    disabled={isSubmitting}
                                    className={`${classPrefix}-form-input`}
                                />
                            </div>
                            <div className={`${classPrefix}-form-group`}>
                                <label htmlFor="inviteCode" className={`${classPrefix}-form-label`}>
                                    Invite Code
                                </label>
                                <input
                                    id="inviteCode"
                                    name="inviteCode"
                                    type="text"
                                    value={credentials.inviteCode}
                                    onChange={handleInputChange}
                                    placeholder="Enter your invite code"
                                    disabled={isSubmitting}
                                    className={`${classPrefix}-form-input`}
                                />
                            </div>
                        </>
                    )}

                    {/* Session Key Checkbox Logic */}
                    {forceSessionKey === false ? null : (
                        <div className={`${classPrefix}-form-group`}>
                            <label
                                htmlFor="autoSessionKey"
                                style={{ display: "flex", flexDirection: "row", alignItems: "center" }}
                            >
                                <input
                                    id="autoSessionKey"
                                    name="autoSessionKey"
                                    type="checkbox"
                                    checked={autoSessionKey}
                                    onChange={
                                        forceSessionKey === undefined
                                            ? (e) => setAutoSessionKey(e.target.checked)
                                            : undefined
                                    }
                                    disabled={isSubmitting || forceSessionKey === true}
                                    style={{ marginRight: 8, height: "1.4em", width: "1.4em" }}
                                />
                                {forceSessionKey === true ? (
                                    <span>Session key will be created (required)</span>
                                ) : (
                                    <span>Create a session key for this website</span>
                                )}
                            </label>
                        </div>
                    )}

                    {error && <div className={`${classPrefix}-error-message`}>{error}</div>}
                    {statusMessage && <div className={`${classPrefix}-status-message`}>{statusMessage}</div>}

                    <button type="submit" className={`${classPrefix}-auth-submit-button`} disabled={isSubmitting}>
                        {isSubmitting ? "Processing..." : mode === "login" ? "Login" : "Create Account"}
                    </button>
                </form>
            )}
        </div>
    );
};
