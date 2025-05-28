import { useEffect } from "react";
import { AppEvent, webSocketService } from "../services/WebSocketService";
import { useWebSocketContext } from "../providers/WebSocketProvider";

type EventHandler = (event: AppEvent["TxEvent"]) => void;

export function useWebSocketConnection(address: string | undefined, onTxEvent: EventHandler) {
    const { connect, disconnect, currentAccount } = useWebSocketContext();

    useEffect(() => {
        if (!address) return;

        // Only connect if we're not already connected to this account
        if (currentAccount !== address) {
            connect(address);
        }

        // Subscribe to transaction events
        const unsubscribeTxEvents = webSocketService.subscribeToTxEvents(onTxEvent);

        // Only cleanup subscription on unmount, don't disconnect
        return () => {
            unsubscribeTxEvents();
        };
    }, [address, connect, currentAccount, onTxEvent]);

    return { connect, disconnect };
}
