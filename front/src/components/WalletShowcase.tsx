import React from 'react';
import { HyleWallet } from '../../../hyle-wallet/src';

type ProviderOption = 'password' | 'google' | 'github';

interface WalletShowcaseProps {
  providers: ProviderOption[];
}

export const WalletShowcase: React.FC<WalletShowcaseProps> = ({ providers }) => {
  return (
    <div className="showcase-container">
      <div className="showcase-header">
        <h1>Wallet Integration</h1>
        <p>Connect to your wallet using the default modal or your own custom UI.</p>
      </div>
      <HyleWallet providers={providers} />
    </div>
  );
}; 