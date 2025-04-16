import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Wallet } from '../../types/wallet';

interface WalletLayoutProps {
  wallet: Wallet;
}

export const WalletLayout = ({ wallet }: WalletLayoutProps) => {
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (path: string) => {
    return location.pathname === path;
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>Hyle Wallet</h1>
        <div className="wallet-info">
          <span>Welcome, {wallet.username}</span>
        </div>
      </header>

      <div className="wallet-container">
        <div className="tabs">
          <button 
            className={isActive('/wallet/balance') ? 'active' : ''} 
            onClick={() => navigate('/wallet/balance')}
          >
            Balance
          </button>
          <button 
            className={isActive('/wallet/send') ? 'active' : ''} 
            onClick={() => navigate('/wallet/send')}
          >
            Send/Receive
          </button>
          <button 
            className={isActive('/wallet/history') ? 'active' : ''} 
            onClick={() => navigate('/wallet/history')}
          >
            History
          </button>
        </div>

        <div className="content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}; 