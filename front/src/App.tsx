import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import './App.css';
import { WalletShowcase } from './components/WalletShowcase';
import { useWalletBalance } from './hooks/useWalletBalance';
import { useWalletTransactions } from './hooks/useWalletTransactions';
import { useWebSocketConnection } from './hooks/useWebSocketConnection';
import { getPublicRoutes, getProtectedRoutes, ROUTES } from './routes/routes';
import { WalletProvider, useWallet } from 'hyle-wallet';
import { LoadingErrorState } from './components/common/LoadingErrorState';
import { WebSocketProvider } from './providers/WebSocketProvider';

function AppContent() {
  const { wallet, logout, stage, error } = useWallet();
  const navigate = useNavigate();
  
  // Use custom hooks
  const { balance, fetchBalance } = useWalletBalance(wallet?.address);
  const { 
    transactions, 
    handleTxEvent 
  } = useWalletTransactions(wallet?.address);
  
  // Setup WebSocket connection
  useWebSocketConnection(wallet?.address, event => {
    handleTxEvent(event);
    // If transaction was successful, update balance
    if (event.tx.status === 'Success') {
      fetchBalance();
    }
  });

  // Redirect back to root on auth settlement error and show message via state
  useEffect(() => {
    if (stage === 'error') {
      navigate(ROUTES.ROOT, { state: { authError: error } });
    }
  }, [stage, error, navigate]);

  const handleLogout = () => {
    logout();
    navigate(ROUTES.ROOT);
  };

  if (error) {
    return <LoadingErrorState isLoading={false} error={error} />;
  }

  // If wallet is not connected, show the showcase screen
  if (!wallet) {
    return <WalletShowcase providers={['password', 'google', 'github']} />;
  }

  // Generate routes based on authentication state
  const publicRoutes = getPublicRoutes();
  const protectedRoutes = getProtectedRoutes(wallet, balance, transactions, handleLogout);
  const allRoutes = [...publicRoutes, ...protectedRoutes];

  return <Routes>{allRoutes.map(route => 
    <Route 
      key={route.path} 
      path={route.path} 
      element={route.element}
    >
      {route.children?.map(childRoute => (
        <Route 
          key={childRoute.path} 
          path={childRoute.path} 
          element={childRoute.element} 
          index={childRoute.index}
        />
      ))}
    </Route>
  )}</Routes>;
}

export default function App() {
  return (
    <BrowserRouter>
      <WalletProvider config={{
        nodeBaseUrl: import.meta.env.VITE_NODE_BASE_URL,
        walletServerBaseUrl: import.meta.env.VITE_WALLET_SERVER_BASE_URL,
        applicationWsUrl: import.meta.env.VITE_WALLET_WS_URL
      }}>
        <WebSocketProvider>
          <AppContent />
        </WebSocketProvider>
      </WalletProvider>
    </BrowserRouter>
  );
}
