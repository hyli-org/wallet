import React from "react";
import { HyliWallet } from "hyli-wallet";
import { useLocation } from "react-router-dom";
import { ErrorMessage } from "./ErrorMessage";

type ProviderOption = "password" | "google" | "github";

interface WalletShowcaseProps {
    providers: ProviderOption[];
}

export const WalletShowcase: React.FC<WalletShowcaseProps> = ({ providers }) => {
    const location = useLocation();
    const authError = (location.state as any)?.authError as string | undefined;

    return (
        <div className="showcase-container">
            <div className="showcase-header">
                <h1>Wallet Integration</h1>
                <p>Connect to your wallet using the default modal or your own custom UI.</p>
            </div>
            {authError && <ErrorMessage error={new Error(authError)} />}
            <HyliWallet providers={providers} />
        </div>
    );
};
