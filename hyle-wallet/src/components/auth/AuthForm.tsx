import React, { useState, useEffect } from 'react';
import { AuthCredentials, AuthProvider } from '../../providers/BaseAuthProvider';
import { useWallet, ProviderOption } from '../../hooks/useWallet';
import { AuthStage } from '../../types/login';
import './AuthForm.css';

interface AuthFormProps {
  provider: AuthProvider;
  mode: 'login' | 'register';
}

export const AuthForm: React.FC<AuthFormProps> = ({
  provider,
  mode,
}) => {
  const { login, registerAccount: registerWallet, stage } = useWallet();
  const [credentials, setCredentials] = useState<AuthCredentials>({
    username: 'bob',
    password: 'password123',
    confirmPassword: 'password123'
  });
  const [error, setError] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Derive UI messaging from stage
  const deriveStatusMessage = (stage: AuthStage): string => {
    switch (stage) {
      case 'submitting':
        return 'Sending transaction...';
      case 'blobSent':
        return 'Waiting for transaction confirmation...';
      case 'settled':
        return 'Success!';
      case 'error':
        return 'Error occurred';
      default:
        return '';
    }
  };

  const statusMessage = deriveStatusMessage(stage);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    const authAction = mode === 'login' ? login : registerWallet;

    authAction(provider.type as ProviderOption, credentials).catch((err) => {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';
      setError(errorMessage);
      setIsSubmitting(false);
    });
  };

  // Reset local submitting flag whenever stage transitions away from 'submitting'
  useEffect(() => {
    if (stage !== 'submitting') {
      setIsSubmitting(false);
    }
  }, [stage]);

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
          disabled={isSubmitting || stage === 'submitting' || stage === 'blobSent'}
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
          disabled={isSubmitting || stage === 'submitting' || stage === 'blobSent'}
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
            disabled={isSubmitting || stage === 'submitting' || stage === 'blobSent'}
          />
        </div>
      )}

      {error && <div className="error-message">{error}</div>}
      {statusMessage && <div className="status-message">{statusMessage}</div>}

      <button
        type="submit"
        className="auth-submit-button"
        disabled={isSubmitting || stage === 'submitting' || stage === 'blobSent'}
      >
        {stage === 'submitting'
          ? 'Processing...'
          : stage === 'blobSent'
          ? 'Pending…'
          : mode === 'login'
          ? 'Login'
          : 'Create Account'}
      </button>
    </form>
  );
};