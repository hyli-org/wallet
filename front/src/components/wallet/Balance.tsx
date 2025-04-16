import { Wallet } from '../../types/wallet';

interface BalanceProps {
  wallet: Wallet;
  balance: number;
}

export const Balance = ({ wallet, balance }: BalanceProps) => {
  return (
    <div className="balance-section">
      <h2>Your Balance</h2>
      <div className="balance-amount">{balance} HYLLAR</div>
      <div className="currency-note">
        <small>HYLLAR (from "hyle" + "dollar") - The currency of the Hyle tesnet network</small>
      </div>
      <div className="receive-section">
        <h3>Receive Funds</h3>
        <div className="address-display">
          <p>Your address:</p>
          <code>{wallet.address}</code>
          <button onClick={() => navigator.clipboard.writeText(wallet.address)}>
            Copy Address
          </button>
        </div>
      </div>
    </div>
  );
}; 