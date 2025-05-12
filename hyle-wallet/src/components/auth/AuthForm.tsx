import React, { useState } from 'react';
import { AuthCredentials, AuthProvider, AuthResult } from '../../providers/BaseAuthProvider';
import { useWallet, ProviderOption } from '../../hooks/useWallet';
import './AuthForm.css';

interface AuthFormProps {
  provider: AuthProvider;
  mode: 'login' | 'register';
}

export const AuthForm: React.FC<AuthFormProps> = ({
  provider,
  mode,
}) => {
  const { login, register: registerWallet } = useWallet();
  const [credentials, setCredentials] = useState<AuthCredentials>({
    username: 'bob',
    password: 'password123',
    confirmPassword: 'password123'
  });
  const [error, setError] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [status, setStatus] = useState<string>('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    setStatus('Processing...');

    const authAction = mode === 'login' ? login : registerWallet;

    try {
      await authAction(provider.type as ProviderOption, credentials);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';
      setError(errorMessage);
    } finally {
      setIsLoading(false);
      setStatus('');
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setCredentials(prev => ({
      ...prev,
      [name]: value
    }));
  };

  return (
    <form onSubmit={handleSubmit} className="auth-form">
      <div className="form-group">
        <label htmlFor="username">Username</label>
        <input
          id="username"
          name="username"
          type="text"
          value={credentials.username}
          onChange={handleInputChange}
          placeholder="Enter your username"
          disabled={isLoading}
        />
      </div>

      <div className="form-group">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          value={credentials.password}
          onChange={handleInputChange}
          placeholder="Enter your password"
          disabled={isLoading}
        />
      </div>

      {mode === 'register' && (
        <div className="form-group">
          <label htmlFor="confirmPassword">Confirm Password</label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            value={credentials.confirmPassword}
            onChange={handleInputChange}
            placeholder="Confirm your password"
            disabled={isLoading}
          />
        </div>
      )}

      {error && <div className="error-message">{error}</div>}
      {status && <div className="status-message">{status}</div>}

      <button
        type="submit"
        className="auth-submit-button"
        disabled={isLoading}
      >
        {isLoading ? 'Processing...' : mode === 'login' ? 'Login' : 'Create Account'}
      </button>
    </form>
  );
};