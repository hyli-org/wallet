import { Wallet } from "hyli-wallet";
import { useWalletBalance } from "../../hooks/useWalletBalance";

interface BalanceProps {
    wallet: Wallet;
}

export const Balance = ({ wallet }: BalanceProps) => {
    const { balance } = useWalletBalance(wallet?.address, "oranj");
    const { balance: oxygenBalance } = useWalletBalance(wallet?.address, "oxygen");
    const { balance: vitaminBalance } = useWalletBalance(wallet?.address, "vitamin");

    const balances = [
        {
            amount: balance,
            currency: "ORANJ",
        },
        {
            amount: oxygenBalance,
            currency: "OXYGEN",
        },
        {
            amount: vitaminBalance,
            currency: "VITAMIN",
        },
    ];
    return (
        <div className="balance-section">
            <h2>Your Balance</h2>
            {balances.map((item, index) => (
                <div key={index} className="balance-amount">
                    {item.amount} {item.currency}
                </div>
            ))}
            <div className="receive-section">
                <h3>Receive Funds</h3>
                <div className="address-display">
                    <p>Your address:</p>
                    <code>{wallet.address}</code>
                    <button 
                        className="btn-secondary btn-sm"
                        onClick={() => navigator.clipboard.writeText(wallet.address)}
                    >
                        Copy Address
                    </button>
                    <div className="faucet-link">
                        <a
                            className="btn-primary btn-sm"
                            href={`${import.meta.env.VITE_FAUCET_URL}/?wallet=${wallet.address}`}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            Go to Faucet
                        </a>
                    </div>
                </div>
            </div>
        </div>
    );
};
