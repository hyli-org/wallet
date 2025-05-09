import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './App.css';
import { Balance } from './components/wallet/Balance';
import { Send } from './components/wallet/Send';
import { History } from './components/wallet/History';
import { SessionKeys } from './components/wallet/SessionKeys';
import { WalletLayout } from './components/layout/WalletLayout';
import { Wallet, Transaction } from './types/wallet';
import { indexerService } from './services/IndexerService';
import { useConfig } from './hooks/useConfig';
import { AppEvent, webSocketService } from './services/WebSocketService';
import { ConnectWallet } from './components/connect/ConnectWallet';
import { ConnectWalletExamples } from './components/connect/ConnectWalletExamples';

function App() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [balance, setBalance] = useState<number>(0);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const { isLoading: isLoadingConfig, error: configError } = useConfig();

  // Function to fetch balance
  const fetchBalance = async () => {
    if (wallet) {
      const balance = await indexerService.getBalance(wallet.address);
      setBalance(balance);
    }
  };

  // Function to fetch transaction history
  const fetchTransactions = async () => {
    if (wallet) {
      const transactions = await indexerService.getTransactionHistory(wallet.address);
      setTransactions(transactions);
    }
  };

  // Initialize WebSocket connection when wallet is set
  useEffect(() => {
    if (wallet) {
      webSocketService.connect(wallet.address);
      
      const handleTxEvent = async (event: AppEvent['TxEvent']) => {
        console.log('Received transaction event:', event);
        if (event.tx.status === 'Success') {
          // Update balance
          await fetchBalance();
        }
          
        // Update transactions
        const newTransaction: Transaction = event.tx;

        setTransactions(prevTransactions => {
          const existingIndex = prevTransactions.findIndex(tx => tx.id === newTransaction.id);
          if (existingIndex !== -1) {
            console.log('Updating existing transaction');
            // Update existing transaction in-place
            const updatedTransactions = [...prevTransactions];
            updatedTransactions[existingIndex] = newTransaction;
            return updatedTransactions;
          } else {
            console.log('Adding new transaction');
            // Add new transaction at the beginning of the list
            return [newTransaction, ...prevTransactions];
          }
        });
      };

      const unsubscribeTxEvents = webSocketService.subscribeToTxEvents(handleTxEvent);

      // Initial data fetch
      fetchBalance();
      fetchTransactions();

      return () => {
        unsubscribeTxEvents();
        webSocketService.disconnect();
      };
    }
  }, [wallet]);

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
      {/* Global connect wallet modal (renders its own button) */}
      {!wallet && (
        <div className="showcase-container">
          <div className="showcase-header">
            <h1>Wallet Integration</h1>
            <p>Connect to your wallet using a fully customizable modal component.</p>
          </div>
          <ConnectWalletExamples onWalletConnected={handleWalletLoggedIn} />
        </div>
      )}
      <Routes>
        <Route path="/" element={
          wallet ? <Navigate to="/wallet/balance" replace /> : <div />
        } />

        {wallet && (
          <Route path="/wallet" element={<WalletLayout wallet={wallet} onLogout={handleLogout} />}>
            <Route path="balance" element={<Balance wallet={wallet} balance={balance} />} />
            <Route path="send" element={<Send wallet={wallet} />} />
            <Route path="history" element={<History transactions={transactions} />} />
            <Route path="session-keys" element={<SessionKeys wallet={wallet} />} />
            <Route index element={<Navigate to="balance" replace />} />
          </Route>
        )}

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
