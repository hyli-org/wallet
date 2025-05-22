import React, { useState, useEffect } from "react";
import { AuthCredentials, AuthProvider } from "../../providers/BaseAuthProvider";
import { ProviderOption, useWalletInternal } from "../../hooks/useWallet";
import { AuthStage } from "../../types/login";
import "./AuthForm.css";

interface AuthFormProps {
    provider: AuthProvider;
    mode: "login" | "register";
    /**
     * CSS class prefix for styling overrides. Default is 'hyli'
     */
    classPrefix?: string;
}

export const AuthForm: React.FC<AuthFormProps> = ({ provider, mode, classPrefix }) => {
    const {
        login,
        registerAccount: registerWallet,
        registerSessionKey,
        sessionKeyConfig,
        onWalletEvent,
        onError,
        getOrReuseSessionKey,
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

    const [hasSessionKey, setHasSessionKey] = useState<boolean>(false);
    useEffect(() => {
        let isMounted = true;
        if (mode === "login") {
            getOrReuseSessionKey()
                .then((result) => {
                    if (isMounted) setHasSessionKey(!!result);
                })
                .catch((err) => {
                    if (isMounted) setHasSessionKey(false);
                });
        }
        return () => {
            isMounted = false;
        };
    }, [getOrReuseSessionKey, mode]);

    const deriveStatusMessage = (stage: AuthStage): string => {
        switch (stage) {
            case "submitting":
                return "Sending transaction...";
            case "blobSent":
                return "Waiting for transaction confirmation...";
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
        setSessionKeyStatus("");

        const authAction = mode === "login" ? login : registerWallet;

        try {
            await authAction(provider.type as ProviderOption, credentials, onWalletEventWithStage, onErrorWithStage);
            // If auto session key is enabled, create it after login/register
            if (autoSessionKey) {
                setSessionKeyStatus("Creating session key for this website...");
                try {
                    const duration = sessionKeyConfig?.duration ?? 24 * 60 * 60 * 1000;
                    const whitelist = sessionKeyConfig?.whitelist ?? [];
                    if (!whitelist || whitelist.length === 0) {
                        throw new Error("Session key whitelist must be provided via WalletProvider");
                    }
                    const expiration = Date.now() + duration;
                    await registerSessionKey(
                        credentials.password,
                        expiration,
                        whitelist,
                        onWalletEventWithStage,
                        (err) => {
                            setSessionKeyStatus("Session key creation failed: " + err.message);
                            onErrorWithStage(err);
                        }
                    );
                    setSessionKeyStatus("Session key created for this website.");
                } catch (err) {
                    setSessionKeyStatus(
                        "Session key creation failed: " + (err instanceof Error ? err.message : String(err))
                    );
                }
            }
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

            {(mode === "register" || (mode === "login" && hasSessionKey === false)) && (
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
            )}

            {error && <div className={`${classPrefix}-error-message`}>{error}</div>}
            {statusMessage && <div className={`${classPrefix}-status-message`}>{statusMessage}</div>}
            {sessionKeyStatus && <div className={`${classPrefix}-status-message`}>{sessionKeyStatus}</div>}

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
    );
};
