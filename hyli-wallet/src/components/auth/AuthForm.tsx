import React, { useState, useEffect } from "react";
import { AuthProvider } from "../../providers/BaseAuthProvider";
import { ProviderOption, useWalletInternal } from "../../hooks/useWallet";
import { RegistrationStage, WalletEvent } from "../../types/wallet";
import { getAuthErrorMessage } from "../../utils/errorMessages";
// @ts-ignore: CSS import lacks type declarations
import "./AuthForm.css";
import type { GoogleAuthCredentials } from "../../providers/GoogleAuthProvider";
import type { EthereumWalletAuthCredentials } from "../../providers/EthereumWalletAuthProvider";
import type { PasswordAuthCredentials } from "../../providers/PasswordAuthProvider";
import type { HyliAppAuthCredentials } from "../../providers/HyliAppAuthProvider";
import { HyliAppAuthProvider } from "../../providers/HyliAppAuthProvider";
import { QRCodeDisplay, QRStatus } from "./QRCodeDisplay";
import type { QRSigningRequest } from "../../services/QRSigningService";

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

    /**
     * ID of the selected Ethereum provider (for EIP-6963)
     */
    ethereumProviderId?: string | null;
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

type FormCredentials =
    | (PasswordAuthCredentials & { inviteCode: string })
    | (GoogleAuthCredentials & { inviteCode: string })
    | (EthereumWalletAuthCredentials & { inviteCode: string })
    | (HyliAppAuthCredentials & { inviteCode: string });

export const AuthForm: React.FC<AuthFormProps> = ({
    provider,
    mode,
    classPrefix = "hyli",
    closeModal,
    forceSessionKey,
    setLockOpen,
    ethereumProviderId,
}) => {
    const { login, registerAccount: registerWallet, onWalletEvent, onError } = useWalletInternal();
    const isLocalhost =
        typeof window !== "undefined" &&
        (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
    const providerType = provider.type as ProviderOption;
    const isGoogle = providerType === "google";
    const isEthereum = providerType === "ethereum";
    const isPassword = providerType === "password";
    const isHyliApp = providerType === "hyliapp";

    // QR signing state for HyliApp
    const [qrSigningRequest, setQrSigningRequest] = useState<QRSigningRequest | null>(null);
    const [qrData, setQrData] = useState<string>("");
    const [qrStatus, setQrStatus] = useState<QRStatus>("waiting");

    const createInitialCredentials = (): FormCredentials => {
        const defaultInvite = isLocalhost ? "vip" : "";
        if (isGoogle) {
            return {
                username: "bob",
                googleToken: "",
                inviteCode: defaultInvite,
                type: "google",
            } as FormCredentials;
        }
        if (isEthereum) {
            return {
                username: "bob",
                inviteCode: defaultInvite,
                type: "ethereum",
                providerId: ethereumProviderId,
            } as FormCredentials;
        }
        if (isHyliApp) {
            return {
                username: "bob",
                inviteCode: defaultInvite,
                type: "hyliapp",
            } as FormCredentials;
        }
        return {
            username: "bob",
            password: isLocalhost ? "hylisecure" : "",
            confirmPassword: isLocalhost ? "hylisecure" : "",
            inviteCode: defaultInvite,
            salt: getRandomSalt(),
            type: "password",
        } as FormCredentials;
    };

    const [credentials, setCredentials] = useState<FormCredentials>(() => createInitialCredentials());

    useEffect(() => {
        setCredentials(createInitialCredentials());
    }, [providerType]);
    const [error, setError] = useState<string>("");
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
    const [stage, setStage] = useState<AuthStage>("idle");
    // Session key checkbox state logic
    const [autoSessionKey, setAutoSessionKey] = useState<boolean>(forceSessionKey === true ? true : true);
    const [funFact, setFunFact] = useState<string>(getRandomFact());
    const getSubmitLabel = () => {
        if (isSubmitting) {
            return "Processing...";
        }
        if (isEthereum) {
            return mode === "login" ? "Sign with Ethereum Wallet" : "Create with Ethereum Wallet";
        }
        if (isHyliApp) {
            return mode === "login" ? "Sign with Hyli App" : "Create with Hyli App";
        }
        return mode === "login" ? "Login" : "Create Account";
    };

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

    // Set up QR callbacks for HyliApp provider
    useEffect(() => {
        if (isHyliApp && provider instanceof HyliAppAuthProvider) {
            const hyliAppProvider = provider as HyliAppAuthProvider;
            hyliAppProvider.setQRCallbacks(
                (request, data) => {
                    console.log("[HyliApp] QR Code content:", data);
                    setQrSigningRequest(request);
                    setQrData(data);
                    setQrStatus("waiting");
                },
                (status, errorMsg) => {
                    setQrStatus(status);
                    if (status === "error" || status === "timeout") {
                        setError(errorMsg || "QR signing failed");
                    }
                }
            );

            return () => {
                hyliAppProvider.clearQRCallbacks();
            };
        }
    }, [isHyliApp, provider]);

    const handleQRCancel = () => {
        setQrSigningRequest(null);
        setQrData("");
        setQrStatus("waiting");
        setIsSubmitting(false);
        setStage("idle");
    };

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

    const handleGoogleSubmit = async (_: React.FormEvent) => {
        try {
            setIsSubmitting(true);
            setStage("sending_blob");

            const idToken = await (window as any).hyliRequestGoogleIdToken?.();
            if (!idToken) {
                setError("Google sign-in failed or was cancelled");
                setIsSubmitting(false);
                return;
            }

            console.log("[Hyli][AuthForm] received Google token", idToken);

            setCredentials((prev) => ({
                ...(prev as any),
                googleToken: idToken,
            }));

            if (mode == "login") {
                await login(
                    provider.type as ProviderOption,
                    {
                        googleToken: idToken,
                        inviteCode: credentials.inviteCode,
                        username: credentials.username,
                    } as any,
                    onWalletEventWithStage,
                    onErrorWithStage,
                    { registerSessionKey: autoSessionKey }
                );
            } else {
                await registerWallet(
                    provider.type as ProviderOption,
                    {
                        googleToken: idToken,
                        inviteCode: credentials.inviteCode,
                        username: credentials.username,
                    } as any,
                    onWalletEventWithStage,
                    onErrorWithStage,
                    { registerSessionKey: autoSessionKey }
                );
            }
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

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");

        if (!credentials.username) {
            setError("Please provide a username");
            return;
        }
        const cred = credentials as FormCredentials;
        if (isPassword) {
            const passwordCreds = cred as PasswordAuthCredentials & { inviteCode: string };
            if (!passwordCreds.password) {
                setError("Please provide a password");
                return;
            }
            if (passwordCreds.password.length < 8) {
                setError("Password must be at least 8 characters long");
                return;
            }
            if (mode === "register" && passwordCreds.password !== passwordCreds.confirmPassword) {
                setError("Passwords do not match.");
                return;
            }
        }
        if (mode === "register" && !cred.inviteCode) {
            setError("Invite code is required.");
            return;
        }
        setIsSubmitting(true);
        setStage("sending_blob");

        const authAction = async (provider: ProviderOption, submittedCredentials: FormCredentials) => {
            console.log("[Hyli][AuthForm] submit", {
                provider,
                mode,
                username: (submittedCredentials as any).username,
                hasGoogleToken: Boolean((submittedCredentials as any).googleToken),
            });

            if (mode === "login") {
                await login(provider, submittedCredentials, onWalletEventWithStage, onErrorWithStage, {
                    registerSessionKey: autoSessionKey,
                });
            } else if (mode === "register") {
                let finalCreds = submittedCredentials as any;
                console.log("[Hyli][AuthForm] registering with credentials", {
                    ...finalCreds,
                    googleToken: Boolean(finalCreds.googleToken),
                });
                await registerWallet(provider, finalCreds, onWalletEventWithStage, onErrorWithStage, {
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
            {/* Loading Modal-Within-Modal - hide during HyliApp QR signing */}
            {["sending_blob", "generating_proof", "sending_proof", "proof_sent"].includes(stage) &&
             !(isHyliApp && qrSigningRequest) && (
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
            ) : isHyliApp ? (
                // HyliApp flow: Show form first, then QR code on submit
                <div className={`${classPrefix}-auth-form`}>
                    {/* QR Code Display - shown when submitting and waiting for signature */}
                    {qrSigningRequest && isSubmitting ? (
                        <QRCodeDisplay
                            signingRequest={qrSigningRequest}
                            qrData={qrData}
                            onCancel={handleQRCancel}
                            status={qrStatus}
                            classPrefix={classPrefix}
                        />
                    ) : (
                        <form onSubmit={handleSubmit}>
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
                                    placeholder={mode === "login" ? "Enter your username" : "Choose a username"}
                                    disabled={isSubmitting}
                                    className={`${classPrefix}-form-input`}
                                />
                            </div>

                            {mode === "register" && (
                                <div className={`${classPrefix}-form-group`}>
                                    <label htmlFor="inviteCode" className={`${classPrefix}-form-label`}>
                                        Invite Code
                                    </label>
                                    <input
                                        id="inviteCode"
                                        name="inviteCode"
                                        type="text"
                                        value={(credentials as any).inviteCode}
                                        onChange={handleInputChange}
                                        placeholder="Enter your invite code"
                                        disabled={isSubmitting}
                                        className={`${classPrefix}-form-input`}
                                    />
                                </div>
                            )}

                            {error && <div className={`${classPrefix}-error-message`}>{error}</div>}

                            <button type="submit" className={`${classPrefix}-auth-submit-button`} disabled={isSubmitting}>
                                {mode === "login"
                                    ? isSubmitting ? "Logging in..." : "Login"
                                    : isSubmitting ? "Creating Account..." : "Create Account"}
                            </button>
                        </form>
                    )}
                </div>
            ) : (
                <form onSubmit={handleSubmit} className={`${classPrefix}-auth-form`}>
                    {
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
                    }

                    {isPassword && (
                        <div className={`${classPrefix}-form-group`}>
                            <label htmlFor="password" className={`${classPrefix}-form-label`}>
                                Password
                            </label>
                            <input
                                id="password"
                                name="password"
                                type="password"
                                value={(credentials as any).password}
                                onChange={handleInputChange}
                                placeholder="Enter your password (min. 8 characters)"
                                disabled={isSubmitting}
                                className={`${classPrefix}-form-input`}
                            />
                        </div>
                    )}

                    {mode === "register" && isPassword && (
                        <>
                            <div className={`${classPrefix}-form-group`}>
                                <label htmlFor="confirmPassword" className={`${classPrefix}-form-label`}>
                                    Confirm Password
                                </label>
                                <input
                                    id="confirmPassword"
                                    name="confirmPassword"
                                    type="password"
                                    value={(credentials as any).confirmPassword}
                                    onChange={handleInputChange}
                                    placeholder="Confirm your password (min. 8 characters)"
                                    disabled={isSubmitting}
                                    className={`${classPrefix}-form-input`}
                                />
                            </div>
                        </>
                    )}

                    {isEthereum && (
                        <div className={`${classPrefix}-form-group`}>
                            <div
                                style={{
                                    fontSize: 13,
                                    lineHeight: 1.4,
                                    color: "#666",
                                }}
                            >
                                When you continue, your Ethereum wallet will request a signature to confirm your identity.
                            </div>
                        </div>
                    )}

                    {mode === "register" && (
                        <div className={`${classPrefix}-form-group`}>
                            <label htmlFor="inviteCode" className={`${classPrefix}-form-label`}>
                                Invite Code
                            </label>
                            <input
                                id="inviteCode"
                                name="inviteCode"
                                type="text"
                                value={(credentials as any).inviteCode}
                                onChange={handleInputChange}
                                placeholder="Enter your invite code"
                                disabled={isSubmitting}
                                className={`${classPrefix}-form-input`}
                            />
                        </div>
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

                    {isGoogle ? (
                        <div className={`${classPrefix}-form-group`}>
                            <button
                                type="button"
                                className={`${classPrefix}-auth-submit-button`}
                                onClick={handleGoogleSubmit}
                                disabled={isSubmitting}
                            >
                                {mode == "login"
                                    ? isSubmitting
                                        ? "Requesting Google token..."
                                        : "Sign in with Google"
                                    : "Bind Account with Google"}
                            </button>
                        </div>
                    ) : null}

                    {error && <div className={`${classPrefix}-error-message`}>{error}</div>}
                    {statusMessage && <div className={`${classPrefix}-status-message`}>{statusMessage}</div>}

                    {providerType !== "google" && (
                        <button type="submit" className={`${classPrefix}-auth-submit-button`} disabled={isSubmitting}>
                            {getSubmitLabel()}
                        </button>
                    )}
                </form>
            )}
        </div>
    );
};
