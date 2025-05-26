import { OnchainWalletEventCallback } from "../types/wallet";
import { ConfigService } from "./ConfigService";

interface RegisterTopicMessage {
    RegisterTopic: string;
}

export interface Transaction {
    id: string;
    type: string;
    amount: number;
    address: string;
    status: string;
    timestamp: number;
}

interface AppEvent {
    TxEvent: {
        account: string;
        tx: Transaction;
    };
    WalletEvent: {
        account: string;
        event: string;
    };
}

export class WebSocketService {
    private static instance: WebSocketService | null = null;
    // private applicationWsUrl: string;
    private ws: WebSocket | null = null;
    private walletEventCallbacks: OnchainWalletEventCallback[] = [];
    private reconnectAttempts: number = 0;
    private maxReconnectAttempts: number = 5;
    private reconnectTimeout: number = 1000; // Base timeout for exponential backoff
    private currentAccount: string | null = null;

    private constructor() {}

    static getInstance(): WebSocketService {
        if (!WebSocketService.instance) {
            WebSocketService.instance = new WebSocketService();
        }
        return WebSocketService.instance;
    }

    connect(account: string) {
        if (this.ws) {
            // An existing WebSocket object.
            if (this.currentAccount === account) {
                // Case 1: Same account.
                if (this.ws.readyState === WebSocket.OPEN) {
                    // Case 1a: Already connected and open to the same account.
                    console.log("WebSocket already connected and open for this account. No action needed.");
                    return;
                } else {
                    // Case 1b: Same account, but WebSocket is not open (e.g., closed after a drop).
                    // This is the reconnect scenario. We need to clean up the old one gently
                    // and proceed to create a new one. Callbacks are preserved because
                    // this.disconnect() is NOT called here.
                    console.log(
                        "WebSocket for the same account exists but is not open. Cleaning up old socket and preparing for new connection."
                    );
                    this.ws.onopen = null;
                    this.ws.onmessage = null;
                    this.ws.onclose = null; // Crucial: prevent old socket's onclose from re-triggering handleReconnect or interfering
                    this.ws.onerror = null;
                    if (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN) {
                        this.ws.close(); // Close if it's connecting or somehow still open/connecting
                    }
                    // `this.ws` will be overwritten by `new WebSocket(...)` shortly.
                    // `this.currentAccount` is already correct. Callbacks are preserved.
                }
            } else {
                // Case 2: Different account.
                // A full disconnect is needed, including clearing old subscriptions for the previous account.
                console.log("Account changed. Disconnecting old WebSocket and clearing its subscriptions.");
                this.disconnect(); // Clears callbacks, currentAccount, and sets this.ws to null.
            }
        }

        // Proceed to establish a new connection.
        // If this.disconnect() was called (Case 2), this.currentAccount is null. So, re-assign it.
        // If it was Case 1b (same account path), this.currentAccount is still correct.
        this.currentAccount = account;
        console.log(`Attempting to connect WebSocket for account: ${account}`);
        const config = ConfigService.getConfig();
        this.ws = new WebSocket(config.applicationWsUrl);

        this.ws.onopen = () => {
            console.log(`WebSocket connected for account: ${this.currentAccount}`);
            this.reconnectAttempts = 0; // Reset reconnect attempts on successful open
            if (this.ws && this.currentAccount) {
                // Ensure ws and currentAccount are still valid post-async
                const registerMessage: RegisterTopicMessage = {
                    RegisterTopic: this.currentAccount,
                };
                console.log("Sending RegisterTopic:", registerMessage);
                this.ws.send(JSON.stringify(registerMessage));
            } else {
                console.warn("WebSocket opened, but ws or currentAccount became null unexpectedly during onopen.");
            }
        };

        this.ws.onmessage = (event) => {
            try {
                // Assuming JSON messages are sent as strings. For binary, further handling is needed.
                const data: AppEvent = JSON.parse(event.data as string);
                if (data.WalletEvent) {
                    this.walletEventCallbacks.forEach((callback) => callback(data.WalletEvent));
                }
            } catch (error) {
                console.error("Error parsing WebSocket message:", error, "Raw data:", event.data);
            }
        };

        this.ws.onclose = () => {
            console.log(
                `WebSocket disconnected. Current account: ${this.currentAccount}. Reconnect attempts: ${this.reconnectAttempts}`
            );
            // Only attempt to reconnect if currentAccount is still set (i.e., not an intentional disconnect by calling disconnect())
            if (this.currentAccount) {
                this.handleReconnect();
            }
        };

        this.ws.onerror = (error) => {
            console.error("WebSocket error:", error);
            // WebSocket onerror usually triggers onclose as well, so reconnect logic is typically in onclose.
        };
    }

    private handleReconnect() {
        if (this.currentAccount) {
            // Only proceed if there's an account context for reconnection
            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                this.reconnectAttempts++;
                // Exponential backoff: e.g., 1s, 2s, 4s, 8s, 16s
                const timeout = this.reconnectTimeout * Math.pow(2, this.reconnectAttempts - 1);
                setTimeout(() => {
                    // Check currentAccount again, in case disconnect() was called clearing it
                    // between the scheduling of this timeout and its execution.
                    if (this.currentAccount) {
                        console.log(
                            `Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts}) for account ${this.currentAccount}. Next attempt in ${timeout}ms.`
                        );
                        this.connect(this.currentAccount);
                    } else {
                        console.log("Reconnect attempt aborted: currentAccount was cleared before execution.");
                    }
                }, timeout);
            } else {
                console.log(
                    `Max reconnect attempts (${this.maxReconnectAttempts}) reached for account ${this.currentAccount}. Will not reconnect further. Call connect() manually to re-initiate.`
                );
                // Optional: could call a full disconnect here or clear currentAccount to stop further onclose->handleReconnect cycles
                // For instance: this.currentAccount = null; // To prevent further automatic reconnections for this session.
            }
        } else {
            console.log(
                "Reconnect attempt skipped: no current account set (likely disconnected intentionally or already handled)."
            );
        }
    }

    subscribeToWalletEvents(callback: OnchainWalletEventCallback): () => void {
        this.walletEventCallbacks.push(callback);
        return () => {
            this.walletEventCallbacks = this.walletEventCallbacks.filter((cb) => cb !== callback);
        };
    }

    unsubscribeFromWalletEvents() {
        this.walletEventCallbacks = [];
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
            this.currentAccount = null;
            this.walletEventCallbacks = [];
        }
    }
}

export const webSocketService = WebSocketService.getInstance();
