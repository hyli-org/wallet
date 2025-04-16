import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './App.css';
import { CreateWallet } from './components/auth/CreateWallet';
import { LoginWallet } from './components/auth/LoginWallet';
import { Balance } from './components/wallet/Balance';
import { Send } from './components/wallet/Send';
import { History } from './components/wallet/History';
import { WalletLayout } from './components/layout/WalletLayout';
import { Wallet, Transaction } from './types/wallet';
import { indexerService } from './services/IndexerService';
import { useConfig } from './hooks/useConfig';

function App() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [balance, setBalance] = useState<number>(0);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [showLogin, setShowLogin] = useState<boolean>(false);
  const { isLoading: isLoadingConfig, error: configError } = useConfig();

  // Fonction pour récupérer le solde et l'historique
  const fetchWalletData = async () => {
    if (wallet) {
      const [balance, transactions] = await Promise.all([
        indexerService.getBalance(wallet.address),
        indexerService.getTransactionHistory(wallet.address)
      ]);
      setBalance(balance);
      setTransactions(transactions);
    }
  };

  // Mettre à jour le solde et l'historique toutes les secondes
  useEffect(() => {
    fetchWalletData();
    const interval = setInterval(fetchWalletData, 1000);
    return () => clearInterval(interval);
  }, [wallet]);

  // Fonction pour récupérer le solde
  const fetchBalance = async () => {
    if (wallet) {
      const balance = await indexerService.getBalance(wallet.address);
      setBalance(balance);
    }
  };

  // Mettre à jour le solde toutes les 10 secondes
  useEffect(() => {
    fetchBalance();
    const interval = setInterval(fetchBalance, 1000);
    return () => clearInterval(interval);
  }, [wallet]);

  const handleWalletCreated = (newWallet: Wallet) => {
    setWallet(newWallet);
    localStorage.setItem('wallet', JSON.stringify(newWallet));
  };

  const handleWalletLoggedIn = (loggedInWallet: Wallet) => {
    setWallet(loggedInWallet);
    localStorage.setItem('wallet', JSON.stringify(loggedInWallet));
  };

  const handleLogout = () => {
    setWallet(null);
    localStorage.removeItem('wallet');
  };

  // Check if wallet exists in localStorage on component mount
  useEffect(() => {
    const storedWallet = localStorage.getItem('wallet');
    if (storedWallet) {
      setWallet(JSON.parse(storedWallet));
    }
  }, []);

  if (isLoadingConfig) {
    return <div>Loading configuration...</div>;
  }

  if (configError) {
    return <div>Error loading configuration: {configError}</div>;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={
          wallet ? <Navigate to="/wallet/balance" replace /> : (
            <div className="auth-container">
              {!showLogin ? (
                <>
                  <CreateWallet onWalletCreated={handleWalletCreated} />
                  <button
                    className="switch-auth-button"
                    onClick={() => setShowLogin(true)}
                  >
                    Already have a wallet? Login here
                  </button>
                </>
              ) : (
                <>
                  <LoginWallet onWalletLoggedIn={handleWalletLoggedIn} />
                  <button
                    className="switch-auth-button"
                    onClick={() => setShowLogin(false)}
                  >
                    Need to create a wallet? Click here
                  </button>
                </>
              )}
            </div>
          )
        } />

        {wallet && (
          <Route path="/wallet" element={<WalletLayout wallet={wallet} onLogout={handleLogout} />}>
            <Route path="balance" element={<Balance wallet={wallet} balance={balance} />} />
            <Route path="send" element={<Send wallet={wallet} />} />
            <Route path="history" element={<History transactions={transactions} />} />
            <Route index element={<Navigate to="balance" replace />} />
          </Route>
        )}

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
