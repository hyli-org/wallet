import React, { useState } from "react";
import { AuthCredentials, AuthProvider } from "../../providers/BaseAuthProvider";
import { useWallet, ProviderOption } from "../../hooks/useWallet";
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
    const { login, registerAccount: registerWallet } = useWallet();
    const [credentials, setCredentials] = useState<AuthCredentials>({
        username: "bob",
        password: "password123",
        confirmPassword: "password123",
    });
    const [error, setError] = useState<string>("");
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
    const [stage, setStage] = useState<AuthStage>("idle");

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

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setIsSubmitting(true);
        setStage("submitting");

        const authAction = mode === "login" ? login : registerWallet;

        try {
            await authAction(
                provider.type as ProviderOption,
                credentials,
                (event) => {
                    if (event.event) {
                        if (event.event.includes("Blob transaction sent")) {
                            setStage("blobSent");
                        } else if (event.event.includes("Proof transaction sent")) {
                            setStage("submitting");
                        }
                    }
                },
                (error) => {
                    setError(error.message);
                    setStage("idle");
                    setIsSubmitting(false);
                }
            );
        } catch (err) {
            setError((err as Error).message);
            setStage("idle");
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

            {error && <div className={`${classPrefix}-error-message`}>{error}</div>}
            {statusMessage && <div className={`${classPrefix}-status-message`}>{statusMessage}</div>}

            <button
                type="submit"
                className={`${classPrefix}-auth-submit-button`}
                disabled={isSubmitting}
            >
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