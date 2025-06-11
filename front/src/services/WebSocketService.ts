export interface Transaction {
    id: string;
    type: "Send" | "Receive" | "Approve" | "Send TransferFrom" | "Receive TransferFrom";
    status: "Sequenced" | "Success" | "Failed" | "Timed Out";
    amount: number;
    address: string;
    timestamp: number;
    token?: string; // Optional field for token type
}

export interface AppEvent {
    TxEvent: {
        account: string;
        tx: Transaction;
    };
    WalletEvent: {
        account: string;
        event: string;
    };
}

interface RegisterTopicMessage {
    RegisterTopic: string;
}

type TxEventCallback = (event: AppEvent["TxEvent"]) => void;
type WalletEventCallback = (event: AppEvent["WalletEvent"]) => void;

export class WebSocketService {
    private ws: WebSocket | null = null;
    private txEventCallbacks: TxEventCallback[] = [];
    private walletEventCallbacks: WalletEventCallback[] = [];
    private reconnectAttempts: number = 0;
    private maxReconnectAttempts: number = 5;
    private reconnectTimeout: number = 1000;
    private currentAccount: string | null = null;

    constructor() {}

    connect(account: string) {
        if (this.ws) {
            console.log("WebSocket already connected");
            if (this.currentAccount != account) {
                this.disconnect();
            } else {
                return;
            }
        }

        this.currentAccount = account;
        this.ws = new WebSocket(import.meta.env.VITE_WALLET_WS_URL);

        this.ws.onopen = () => {
            console.log("WebSocket connected");
            this.reconnectAttempts = 0;
            // Send registration message
            const registerMessage: RegisterTopicMessage = {
                RegisterTopic: account,
            };
            this.ws?.send(JSON.stringify(registerMessage));
        };

        this.ws.onmessage = (event) => {
            try {
                const data: AppEvent = JSON.parse(event.data);
                if (data.TxEvent) {
                    this.txEventCallbacks.forEach((callback) => callback(data.TxEvent));
                }
                if (data.WalletEvent) {
                    this.walletEventCallbacks.forEach((callback) => callback(data.WalletEvent));
                }
            } catch (error) {
                console.error("Error parsing WebSocket message:", error);
            }
        };

        this.ws.onclose = () => {
            console.log("WebSocket disconnected");
            this.handleReconnect();
        };

        this.ws.onerror = (error) => {
            console.error("WebSocket error:", error);
        };
    }

    private handleReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts && this.currentAccount) {
            this.reconnectAttempts++;
            setTimeout(() => {
                console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
                this.connect(this.currentAccount!);
            }, this.reconnectTimeout * this.reconnectAttempts);
        }
    }

    subscribeToTxEvents(callback: TxEventCallback): () => void {
        this.txEventCallbacks.push(callback);
        return () => {
            this.txEventCallbacks = this.txEventCallbacks.filter((cb) => cb !== callback);
        };
    }

    subscribeToWalletEvents(callback: WalletEventCallback): () => void {
        this.walletEventCallbacks.push(callback);
        return () => {
            this.walletEventCallbacks = this.walletEventCallbacks.filter((cb) => cb !== callback);
        };
    }

    unsubscribeFromTxEvents() {
        this.txEventCallbacks = [];
    }

    unsubscribeFromWalletEvents() {
        this.walletEventCallbacks = [];
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
            this.currentAccount = null;
            this.txEventCallbacks = [];
            this.walletEventCallbacks = [];
        }
    }
}

export const webSocketService = new WebSocketService();
