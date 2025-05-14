import { useEffect, useCallback } from 'react';
import { AppEvent, webSocketService } from '../services/WebSocketService';

type EventHandler = (event: AppEvent['TxEvent']) => void;

export function useWebSocketConnection(
  address: string | undefined,
  onTxEvent: EventHandler
) {
  const connect = useCallback(() => {
    if (!address) return;
    webSocketService.connect(address);
  }, [address]);

  const disconnect = useCallback(() => {
    webSocketService.disconnect();
  }, []);

  useEffect(() => {
    if (!address) return;

    // Connect to WebSocket
    connect();

    // Subscribe to transaction events
    const unsubscribeTxEvents = webSocketService.subscribeToTxEvents(onTxEvent);

    // Cleanup on unmount
    return () => {
      unsubscribeTxEvents();
      disconnect();
    };
  }, [address, connect, disconnect, onTxEvent]);

  return { connect, disconnect };
} 