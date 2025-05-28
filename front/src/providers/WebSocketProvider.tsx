import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { webSocketService } from "../services/WebSocketService";

interface WebSocketContextType {
    isConnected: boolean;
    currentAccount: string | null;
    connect: (address: string) => void;
    disconnect: () => void;
}

const WebSocketContext = createContext<WebSocketContextType | null>(null);

export function WebSocketProvider({ children }: { children: ReactNode }) {
    const [isConnected, setIsConnected] = useState(false);
    const [currentAccount, setCurrentAccount] = useState<string | null>(null);

    const connect = (address: string) => {
        webSocketService.connect(address);
        setCurrentAccount(address);
        setIsConnected(true);
    };

    const disconnect = () => {
        webSocketService.disconnect();
        setCurrentAccount(null);
        setIsConnected(false);
    };

    useEffect(() => {
        // Cleanup on unmount
        return () => {
            disconnect();
        };
    }, []);

    return (
        <WebSocketContext.Provider
            value={{
                isConnected,
                currentAccount,
                connect,
                disconnect,
            }}
        >
            {children}
        </WebSocketContext.Provider>
    );
}

export const useWebSocketContext = () => {
    const context = useContext(WebSocketContext);
    if (!context) {
        throw new Error("useWebSocketContext must be used within a WebSocketProvider");
    }
    return context;
};
