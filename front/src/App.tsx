import { useState, useEffect } from 'react';
import './App.css';

interface ContractState {
  state: any;
  error?: string;
}

function App() {
  const [contract1State, setContract1State] = useState<ContractState | null>(null);
  const [contract2State, setContract2State] = useState<ContractState | null>(null);
  const [loading, setLoading] = useState(false);
  const [initialResult, setInitialResult] = useState<string | null>(null);
  const [confirmationResult, setConfirmationResult] = useState<string | null>(null);
  const [username, setUsername] = useState(() => localStorage.getItem('username') || '');

  // Save username to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('username', username);
  }, [username]);

  const fetchContractState = async (contractName: string) => {
    try {
      const response = await fetch(`${import.meta.env.VITE_SERVER_BASE_URL}/v1/indexer/contract/${contractName}/state`);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error ${response.status}: ${errorText || response.statusText}`);
      }
      
      const text = await response.text();
      if (!text) {
        throw new Error('Empty response');
      }
      
      const data = JSON.parse(text);
      return { state: data };
    } catch (error) {
      console.error(`Error fetching ${contractName} state:`, error);
      return { state: null, error: error instanceof Error ? error.message : String(error) };
    }
  };

  useEffect(() => {
    const fetchStates = async () => {
      const [state1, state2] = await Promise.all([
        fetchContractState('contract1'),
        fetchContractState('contract2')
      ]);
      setContract1State(state1);
      setContract2State(state2);
    };

    fetchStates();
    // Refresh states every minute
    const interval = setInterval(fetchStates, 60000);
    return () => clearInterval(interval);
  }, []);

  const pollTransactionStatus = async (txHash: string): Promise<void> => {
    const maxAttempts = 30; // 30 seconds timeout
    let attempts = 0;
    
    while (attempts < maxAttempts) {
      try {
        const response = await fetch(`${import.meta.env.VITE_NODE_BASE_URL}/v1/indexer/transaction/hash/${txHash}`);
        if (!response.ok) {
          throw new Error(`HTTP error ${response.status}`);
        }
        
        const data = await response.json();
        if (data.transaction_status === "Success") {
          setConfirmationResult(`Transaction confirmed successful! Hash: ${txHash}`);
          return;
        }
        
        // Wait 1 second before next attempt
        await new Promise(resolve => setTimeout(resolve, 1000));
        attempts++;
      } catch (error) {
        console.error('Error polling transaction:', error);
        // Continue polling even if there's an error
      }
    }
    
    setConfirmationResult(`Transaction ${txHash} timed out after ${maxAttempts} seconds`);
  };

  const sendBlobTx = async () => {
    if (!username) {
      setInitialResult('Please enter a username first. e.g. <username>.contract1');
      setConfirmationResult(null);
      return;
    }

    setLoading(true);
    setConfirmationResult(null);
    try {
      const response = await fetch(`${import.meta.env.VITE_SERVER_BASE_URL}/api/increment`, {
        method: 'POST',
        headers: {
          'x-user': username,
          'x-session-key': 'test-session',
          'x-request-signature': 'test-signature'
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `HTTP error ${response.status}`);
      }

      const data = await response.json();
      setInitialResult(`Transaction sent! Hash: ${JSON.stringify(data)}`);
      
      // Start polling for transaction status
      await pollTransactionStatus(data);
    } catch (error) {
      console.error('Error sending transaction:', error);
      setInitialResult(`Error: ${error instanceof Error ? error.message : String(error)}`);
      setConfirmationResult(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="App">
      <div className="user-input">
        <input
          type="text"
          placeholder="Enter username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="username-input"
        />
      </div>
      <button 
        className="blob-button" 
        onClick={sendBlobTx}
        disabled={loading}
      >
        {loading ? 'SENDING...' : 'SEND BLOB TX'}
      </button>
      {initialResult && <div className="result">{initialResult}</div>}
      {confirmationResult && <div className="result">{confirmationResult}</div>}
      <div className="contract-states">
        <div className="contract-state">
          <h2>Contract 1 State</h2>
          {contract1State?.error ? (
            <div className="error">{contract1State.error}</div>
          ) : (
            <pre>{contract1State?.state ? JSON.stringify(contract1State.state, null, 2) : 'Loading...'}</pre>
          )}
        </div>
        <div className="contract-state">
          <h2>Contract 2 State</h2>
          {contract2State?.error ? (
            <div className="error">{contract2State.error}</div>
          ) : (
            <pre>{contract2State?.state ? JSON.stringify(contract2State.state, null, 2) : 'Loading...'}</pre>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
