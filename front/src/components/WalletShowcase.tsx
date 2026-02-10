import React from "react";
import { HyliWallet, ProviderOption } from "hyli-wallet";

interface WalletShowcaseProps {
    providers: ProviderOption[];
}

export const WalletShowcase: React.FC<WalletShowcaseProps> = ({ providers }) => {
    return (
        <div className="wallet-showcase-container">
            <div className="wallet-showcase-logo">
                <img
                    src="https://cdn.prod.website-files.com/67feddab25a3d6e0f91ec981/680c3634a508fe47cc1c840c_hyli_svg_orange.svg"
                    alt="hyli logo"
                />
                🍊
            </div>
            <HyliWallet providers={providers} />
        </div>
    );
};
