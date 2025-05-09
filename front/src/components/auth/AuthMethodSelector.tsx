import React from 'react';
import './AuthMethod.css';

export type AuthMethodType = 'password';

interface AuthMethodSelectorProps {
  onSelect: (method: AuthMethodType) => void;
}

export const AuthMethodSelector: React.FC<AuthMethodSelectorProps> = ({ onSelect }) => {
  return (
    <div className="auth-method-selector">
      <h1>Choose Authentication Method</h1>
      <div className="auth-options">
        <button
          className="auth-option"
          onClick={() => onSelect('password')}
        >
          <div className="auth-option-content">
            <h3>Username & Password</h3>
            <p>Create an account using a username and password</p>
            <ul>
              <li>Simple and familiar authentication method</li>
              <li>Password is hashed and stored securely</li>
              <li>Can be used with session keys later</li>
            </ul>
          </div>
        </button>
        {/* More auth methods can be added here later */}
      </div>
    </div>
  );
};