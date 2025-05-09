import React from 'react';
import { ConnectWallet, ProviderOption } from './ConnectWallet';
import { Wallet } from '../../types/wallet';
import './ConnectWalletExamples.css';

interface ConnectWalletExamplesProps {
  onWalletConnected?: (wallet: Wallet) => void;
}

export const ConnectWalletExamples: React.FC<ConnectWalletExamplesProps> = ({
  onWalletConnected
}) => {
  // Different provider combinations
  const providerSets: { title: string; providers: ProviderOption[] }[] = [
    { title: 'All Providers', providers: ['password', 'google', 'github', 'x'] },
    { title: 'Social Only', providers: ['google', 'github', 'x'] },
    { title: 'Password Only', providers: ['password'] },
    { title: 'Google & GitHub', providers: ['google', 'github'] }
  ];

  // Example button render functions
  const buttonVariants = [
    {
      title: 'Primary Button',
      render: ({ onClick }: { onClick: () => void }) => (
        <button className="connect-example-primary" onClick={onClick}>
          Connect Account
        </button>
      )
    },
    {
      title: 'Outline Button',
      render: ({ onClick }: { onClick: () => void }) => (
        <button className="connect-example-outline" onClick={onClick}>
          Connect Account
        </button>
      )
    },
    {
      title: 'Rounded Button',
      render: ({ onClick }: { onClick: () => void }) => (
        <button className="connect-example-rounded" onClick={onClick}>
          Connect
        </button>
      )
    },
    {
      title: 'With Icon',
      render: ({ onClick }: { onClick: () => void }) => (
        <button className="connect-example-with-icon" onClick={onClick}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="2" y="6" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="2" />
            <path d="M16 14C16 15.1046 16.8954 16 18 16C19.1046 16 20 15.1046 20 14C20 12.8954 19.1046 12 18 12C16.8954 12 16 12.8954 16 14Z" fill="currentColor" />
            <path d="M2 10H22" stroke="currentColor" strokeWidth="2" />
          </svg>
          Connect
        </button>
      )
    },
    {
      title: 'Text Only',
      render: ({ onClick }: { onClick: () => void }) => (
        <button className="connect-example-text" onClick={onClick}>
          Sign in
        </button>
      )
    },
    {
      title: 'Dark Mode',
      render: ({ onClick }: { onClick: () => void }) => (
        <button className="connect-example-dark" onClick={onClick}>
          Connect Account
        </button>
      )
    },
    {
      title: 'Gradient Button',
      render: ({ onClick }: { onClick: () => void }) => (
        <button className="connect-example-gradient" onClick={onClick}>
          Connect
        </button>
      )
    },
    {
      title: 'Minimal Pill',
      render: ({ onClick }: { onClick: () => void }) => (
        <button className="connect-example-minimal-pill" onClick={onClick}>
          Sign in →
        </button>
      )
    },
    {
      title: 'Branded Button',
      render: ({ onClick }: { onClick: () => void }) => (
        <button className="connect-example-branded" onClick={onClick}>
          <span className="branded-icon">🔐</span>
          <span>Secure Connect</span>
        </button>
      )
    }
  ];

  return (
    <div className="connect-examples-container">
      <h2>Connect Account Examples</h2>
      <p>The ConnectWallet component supports customizable buttons and provider lists.</p>

      <h3>Button Style Variations</h3>
      <div className="connect-examples-grid">
        {buttonVariants.map((variant, index) => (
          <div key={index} className="connect-example-card">
            <h4>{variant.title}</h4>
            <div className="connect-example-preview">
              <ConnectWallet 
                providers={['password', 'google', 'github']} 
                button={variant.render} 
                onWalletConnected={onWalletConnected}
              />
            </div>
          </div>
        ))}
      </div>

      <h3>Provider Combinations</h3>
      <div className="connect-examples-grid">
        {providerSets.map((set, index) => (
          <div key={index} className="connect-example-card">
            <h4>{set.title}</h4>
            <pre className="connect-example-code">
              {`providers={${JSON.stringify(set.providers)}}`}
            </pre>
            <div className="connect-example-preview">
              <ConnectWallet 
                providers={set.providers}
                button={({ onClick }) => (
                  <button className="connect-example-outline" onClick={onClick}>
                    Connect
                  </button>
                )} 
                onWalletConnected={onWalletConnected}
              />
            </div>
          </div>
        ))}
      </div>

      <h3>Custom Integration Example</h3>
      <div className="connect-example-navbar">
        <div className="connect-example-logo">MyApp</div>
        <div className="connect-example-nav-items">
          <a href="#" className="connect-example-nav-link">Home</a>
          <a href="#" className="connect-example-nav-link">Features</a>
          <a href="#" className="connect-example-nav-link">About</a>
          <ConnectWallet
            providers={['password', 'google', 'github']}
            button={({ onClick }) => (
              <button className="connect-example-nav-button" onClick={onClick}>
                Sign In
              </button>
            )}
            onWalletConnected={onWalletConnected}
          />
        </div>
      </div>

      <h3>Mobile Integration Example</h3>
      <div className="connect-example-mobile">
        <div className="mobile-statusbar">
          <span>9:41</span>
          <div className="mobile-icons">
            <span>📶</span>
            <span>📡</span>
            <span>🔋</span>
          </div>
        </div>
        <div className="mobile-content">
          <div className="mobile-app-header">
            <div className="mobile-app-title">Mobile App</div>
            <ConnectWallet
              providers={['password', 'google', 'github']}
              button={({ onClick }) => (
                <button className="mobile-connect-button" onClick={onClick}>
                  Login
                </button>
              )}
              onWalletConnected={onWalletConnected}
            />
          </div>
          <div className="mobile-app-body">
            <div className="mobile-placeholder"></div>
            <div className="mobile-placeholder short"></div>
            <div className="mobile-placeholder"></div>
            <div className="mobile-placeholder short"></div>
          </div>
        </div>
      </div>
    </div>
  );
}; 