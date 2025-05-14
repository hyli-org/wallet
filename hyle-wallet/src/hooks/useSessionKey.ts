// Hook to use session key generation and utilities
import { useCallback } from 'react';
import { sessionKeyService } from '../services/SessionKeyService';
import type { Blob } from 'hyle';

export const useSessionKey = () => {
  const generateSessionKey = useCallback((): [string, string] => {
    return sessionKeyService.generateSessionKey();
  }, []);

  const clearSessionKey = useCallback((publicKey: string) => {
    sessionKeyService.clear(publicKey);
  }, []);

  const createSignedBlobs = useCallback((account: string, privateKey: string): [Blob, Blob] => {
    return sessionKeyService.useSessionKey(account, privateKey, Date.now());
  }, []);

  return {
    generateSessionKey,
    clearSessionKey,
    createSignedBlobs,
  };
}; 