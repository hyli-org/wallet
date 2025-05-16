import React from 'react';

interface LoadingErrorStateProps {
  isLoading: boolean;
  error: string | null;
  loadingMessage?: string;
}

export const LoadingErrorState: React.FC<LoadingErrorStateProps> = ({
  isLoading,
  error,
  loadingMessage = 'Loading...'
}) => {
  if (isLoading) {
    return <div className="loading-state">{loadingMessage}</div>;
  }

  if (error) {
    return <div className="error-state">Error: {error}</div>;
  }

  return null;
}; 