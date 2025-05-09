import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Wallet } from '../../types/wallet';

interface WalletLayoutProps {
  wallet: Wallet;
  onLogout: () => void;
}

export const WalletLayout = ({ wallet, onLogout }: WalletLayoutProps) => {
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
          <button 
            className="logout-button"
            onClick={onLogout}
          >
            Logout
          </button>
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
          <button 
            className={isActive('/wallet/session-keys') ? 'active' : ''} 
            onClick={() => navigate('/wallet/session-keys')}
          >
            Session Keys
          </button>
        </div>

        <div className="content">
          <Outlet />
        </div>
      </div>
    </div>
  );
};