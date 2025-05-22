import React, { useState, useEffect } from "react";
import { AuthCredentials, AuthProvider } from "../../providers/BaseAuthProvider";
import { ProviderOption, useWalletInternal } from "../../hooks/useWallet";
import { AuthStage } from "../../types/login";
import { WalletErrorCallback, WalletEventCallback } from "../../types/wallet";
import "./AuthForm.css";

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
}

export const AuthForm: React.FC<AuthFormProps> = ({ provider, mode, classPrefix = "hyli", closeModal }) => {
    const {
        login,
        registerAccount: registerWallet,
        registerSessionKeyWithWallet,
        sessionKeyConfig,
        onWalletEvent,
        onError,
    } = useWalletInternal();
    const isLocalhost =
        typeof window !== "undefined" &&
        (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
    const [credentials, setCredentials] = useState<AuthCredentials>({
        username: isLocalhost ? "bob" : "",
        password: isLocalhost ? "hylisecure" : "",
        confirmPassword: isLocalhost ? "hylisecure" : "",
    });
    const [error, setError] = useState<string>("");
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
    const [stage, setStage] = useState<AuthStage>("idle");
    const [autoSessionKey, setAutoSessionKey] = useState<boolean>(false);
    const [sessionKeyStatus, setSessionKeyStatus] = useState<string>("");

    // Call closeModal after 1s on successful login
    useEffect(() => {
        if (stage === "settled" && closeModal) {
            const timer = setTimeout(() => {
                closeModal();
            }, 2000);
            return () => clearTimeout(timer);
        }
    }, [stage, closeModal]);

    const deriveStatusMessage = (stage: AuthStage): string => {
        switch (stage) {
            case "submitting":
                return "Sending transaction...";
            case "blobSent":
                return "Waiting for transaction confirmation...";
            case "sessionKey":
                return "Creating session key...";
            case "settled":
                return "Logged on successfully!";
            case "error":
                return "Error occurred";
            default:
                return "";
        }
    };

    const statusMessage = deriveStatusMessage(stage);

    const onWalletEventWithStage = (event: any) => {
        if (event.event) {
            if (event.event.includes("Blob transaction sent")) {
                setStage("blobSent");
            } else if (event.event.includes("Proof transaction sent")) {
                setStage("submitting");
            } else if (event.event.includes("Logged in")) {
                setStage("settled");
            }
        }
        if (onWalletEvent) onWalletEvent(event);
    };
    const onErrorWithStage = (err: Error) => {
        setError(err.message);
        setStage("idle");
        setIsSubmitting(false);
        if (onError) onError(err);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setIsSubmitting(true);
        setStage("submitting");

        const authAction = async (
            provider: ProviderOption,
            credentials: AuthCredentials,
            onWalletEvent?: WalletEventCallback,
            onError?: WalletErrorCallback
        ) => {
            const wallet = await (mode === "login" ? login : registerWallet)(
                provider,
                credentials,
                onWalletEvent,
                onError
            );
            // If auto session key is enabled, create it after login/register
            if (autoSessionKey && wallet) {
                setStage("sessionKey");
                const duration = sessionKeyConfig?.duration ?? 24 * 60 * 60 * 1000;
                const whitelist = sessionKeyConfig?.whitelist ?? [];
                if (!whitelist || whitelist.length === 0) {
                    throw new Error("Session key whitelist must be provided via WalletProvider");
                }
                const expiration = Date.now() + duration;
                await registerSessionKeyWithWallet(
                    wallet,
                    credentials.password,
                    expiration,
                    whitelist,
                    onWalletEventWithStage,
                    onErrorWithStage
                );
            }
            if (wallet) setStage("settled");
        };

        try {
            await authAction(provider.type as ProviderOption, credentials, onWalletEventWithStage, onErrorWithStage);
        } catch (err) {
            setError((err as Error).message);
            setStage("idle");
            setIsSubmitting(false);
        } finally {
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
        <div className={`${classPrefix}-auth-form-container`}>
            {stage === "settled" ? (
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
                        <label htmlFor="username">Username</label>
                        <input
                            id="username"
                            name="username"
                            type="text"
                            value={credentials.username}
                            onChange={handleInputChange}
                            placeholder="Enter your username"
                            disabled={isSubmitting}
                        />
                    </div>

                    <div className={`${classPrefix}-form-group`}>
                        <label htmlFor="password">Password</label>
                        <input
                            id="password"
                            name="password"
                            type="password"
                            value={credentials.password}
                            onChange={handleInputChange}
                            placeholder="Enter your password"
                            disabled={isSubmitting}
                        />
                    </div>

                    {mode === "register" && (
                        <div className={`${classPrefix}-form-group`}>
                            <label htmlFor="confirmPassword">Confirm Password</label>
                            <input
                                id="confirmPassword"
                                name="confirmPassword"
                                type="password"
                                value={credentials.confirmPassword}
                                onChange={handleInputChange}
                                placeholder="Confirm your password"
                                disabled={isSubmitting}
                            />
                        </div>
                    )}

                    {
                        <div
                            className={`${classPrefix}-form-group`}
                            style={{ display: "flex", flexDirection: "row", alignItems: "center" }}
                        >
                            <input
                                id="autoSessionKey"
                                name="autoSessionKey"
                                type="checkbox"
                                checked={autoSessionKey}
                                onChange={(e) => setAutoSessionKey(e.target.checked)}
                                disabled={isSubmitting}
                                style={{ marginRight: 8, height: "1.4em", width: "1.4em" }}
                            />
                            <label htmlFor="autoSessionKey">Create a session key for this website</label>
                        </div>
                    }

                    {error && <div className={`${classPrefix}-error-message`}>{error}</div>}
                    {statusMessage && <div className={`${classPrefix}-status-message`}>{statusMessage}</div>}

                    <button type="submit" className={`${classPrefix}-auth-submit-button`} disabled={isSubmitting}>
                        {isSubmitting
                            ? stage === "submitting"
                                ? "Processing..."
                                : "Pending..."
                            : mode === "login"
                            ? "Login"
                            : "Create Account"}
                    </button>
                </form>
            )}
        </div>
    );
};
