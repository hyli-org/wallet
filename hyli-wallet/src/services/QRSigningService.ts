import { verifySecp256k1Signature, hexToSecp256k1PublicKey, hexToSecp256k1Signature } from "../utils/secp256k1";

export interface QRSigningRequest {
    requestId: string;
    message: string;      // hex-encoded bytes to sign
    description: string;  // human-readable description
    origin: string;       // requesting service name
}

export interface QRSigningResponse {
    requestId: string;
    signature: string;    // 64 bytes hex-encoded secp256k1 signature (r + s)
    publicKey: string;    // 33 bytes hex-encoded compressed secp256k1 public key
}

interface PendingRequest {
    request: QRSigningRequest;
    messageBytes: Uint8Array;
    resolve: (response: { signature: Uint8Array; publicKey: Uint8Array }) => void;
    reject: (error: Error) => void;
    timeoutId: ReturnType<typeof setTimeout>;
    createdAt: number;
}

// WebSocket message types
interface WsSigningResponse {
    type: "SigningResponse";
    requestId: string;
    signature: string;
    publicKey: string;
}

interface WsSigningError {
    type: "SigningError";
    requestId: string;
    error: string;
}

interface WsSigningRequestAck {
    type: "SigningRequestAck";
    requestId: string;
}

type WsIncomingMessage = WsSigningResponse | WsSigningError | WsSigningRequestAck;

export class QRSigningService {
    private static instance: QRSigningService | null = null;
    private ws: WebSocket | null = null;
    private wsUrl: string | null = null;
    private pendingRequests: Map<string, PendingRequest> = new Map();
    private reconnectAttempts: number = 0;
    private maxReconnectAttempts: number = 3;
    private reconnectTimeout: number = 1000;
    private defaultTimeout: number = 120000; // 2 minutes default timeout

    private constructor() {}

    static getInstance(): QRSigningService {
        if (!QRSigningService.instance) {
            QRSigningService.instance = new QRSigningService();
        }
        return QRSigningService.instance;
    }

    /**
     * Set the WebSocket URL for the signing service
     */
    setWsUrl(url: string) {
        if (this.wsUrl !== url) {
            this.disconnect();
            this.wsUrl = url;
        }
    }

    /**
     * Connect to the signing WebSocket server
     */
    private connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.wsUrl) {
                reject(new Error("WebSocket URL not configured"));
                return;
            }

            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                resolve();
                return;
            }

            // Clean up existing connection
            if (this.ws) {
                this.ws.onopen = null;
                this.ws.onmessage = null;
                this.ws.onclose = null;
                this.ws.onerror = null;
                if (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN) {
                    this.ws.close();
                }
            }

            this.ws = new WebSocket(this.wsUrl);

            this.ws.onopen = () => {
                console.log("QR Signing WebSocket connected");
                this.reconnectAttempts = 0;
                resolve();
            };

            this.ws.onmessage = (event) => {
                this.handleMessage(event);
            };

            this.ws.onclose = () => {
                console.log("QR Signing WebSocket disconnected");
                this.handleReconnect();
            };

            this.ws.onerror = (error) => {
                console.error("QR Signing WebSocket error:", error);
                reject(new Error("WebSocket connection failed"));
            };
        });
    }

    private handleMessage(event: MessageEvent) {
        console.log("=== WS MESSAGE RECEIVED ===");
        console.log("Raw message:", event.data);

        try {
            const data: WsIncomingMessage = JSON.parse(event.data as string);
            console.log("Parsed message type:", data.type);
            console.log("Parsed message:", data);

            switch (data.type) {
                case "SigningResponse":
                    console.log("Handling SigningResponse...");
                    this.handleSigningResponse(data);
                    break;
                case "SigningError":
                    console.log("Handling SigningError...");
                    this.handleSigningError(data);
                    break;
                case "SigningRequestAck":
                    console.log(`Signing request ${data.requestId} acknowledged`);
                    break;
                default:
                    console.warn("Unknown message type:", data);
            }
        } catch (error) {
            console.error("Error parsing WebSocket message:", error);
        }
    }

    private async handleSigningResponse(data: WsSigningResponse) {
        const pending = this.pendingRequests.get(data.requestId);
        if (!pending) {
            console.warn(`Received response for unknown request: ${data.requestId}`);
            return;
        }

        try {
            // Debug logging
            console.log("=== VERIFICATION DEBUG ===");
            console.log("Received signature (hex):", data.signature);
            console.log("Signature length:", data.signature.length, "hex chars");
            console.log("Received publicKey (hex):", data.publicKey);
            console.log("PublicKey length:", data.publicKey.length, "hex chars");
            console.log("Original message (hex):", Array.from(pending.messageBytes).map(b => b.toString(16).padStart(2, '0')).join(''));
            console.log("Message length:", pending.messageBytes.length, "bytes");

            const signature = hexToSecp256k1Signature(data.signature);
            const publicKey = hexToSecp256k1PublicKey(data.publicKey);

            console.log("Parsed signature length:", signature.length, "bytes");
            console.log("Parsed publicKey length:", publicKey.length, "bytes");

            // Verify the signature
            const isValid = verifySecp256k1Signature(pending.messageBytes, signature, publicKey);
            console.log("Signature valid:", isValid);
            console.log("=== END VERIFICATION DEBUG ===");

            if (!isValid) {
                throw new Error("Invalid signature");
            }

            clearTimeout(pending.timeoutId);
            this.pendingRequests.delete(data.requestId);
            pending.resolve({ signature, publicKey });
        } catch (error) {
            clearTimeout(pending.timeoutId);
            this.pendingRequests.delete(data.requestId);
            pending.reject(error instanceof Error ? error : new Error("Signature verification failed"));
        }
    }

    private handleSigningError(data: WsSigningError) {
        const pending = this.pendingRequests.get(data.requestId);
        if (!pending) {
            console.warn(`Received error for unknown request: ${data.requestId}`);
            return;
        }

        clearTimeout(pending.timeoutId);
        this.pendingRequests.delete(data.requestId);
        pending.reject(new Error(data.error));
    }

    private handleReconnect() {
        if (this.pendingRequests.size === 0) {
            return; // No pending requests, no need to reconnect
        }

        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const timeout = this.reconnectTimeout * Math.pow(2, this.reconnectAttempts - 1);
            setTimeout(() => {
                if (this.pendingRequests.size > 0) {
                    console.log(`Attempting to reconnect QR Signing WebSocket (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
                    this.connect().catch(console.error);
                }
            }, timeout);
        } else {
            // Reject all pending requests
            for (const [requestId, pending] of this.pendingRequests) {
                clearTimeout(pending.timeoutId);
                pending.reject(new Error("WebSocket connection lost"));
                this.pendingRequests.delete(requestId);
            }
        }
    }

    /**
     * Generate a unique request ID
     */
    generateRequestId(): string {
        return crypto.randomUUID();
    }

    /**
     * Create a QR signing request
     */
    createSigningRequest(
        messageBytes: Uint8Array,
        description: string,
        origin?: string
    ): QRSigningRequest {
        const messageHex = Array.from(messageBytes)
            .map(b => b.toString(16).padStart(2, "0"))
            .join("");

        return {
            requestId: this.generateRequestId(),
            message: messageHex,
            description,
            origin: origin || (typeof window !== "undefined" ? window.location.origin : "unknown"),
        };
    }

    /**
     * Get the JSON string for QR code display
     */
    getQRCodeData(request: QRSigningRequest): string {
        // Convert ws:// to http:// for the callback URL (mobile apps use HTTP POST)
        let callbackUrl = this.wsUrl || "";
        if (callbackUrl.startsWith("ws://")) {
            callbackUrl = callbackUrl.replace("ws://", "http://");
        } else if (callbackUrl.startsWith("wss://")) {
            callbackUrl = callbackUrl.replace("wss://", "https://");
        }

        return JSON.stringify({
            message: request.message,
            description: request.description,
            origin: request.origin,
            requestId: request.requestId,
            callbackUrl: callbackUrl,
        });
    }

    /**
     * Request a signature via QR code
     * Returns a promise that resolves when the signature is received
     */
    async requestSignature(
        request: QRSigningRequest,
        messageBytes: Uint8Array,
        timeoutMs: number = this.defaultTimeout
    ): Promise<{ signature: Uint8Array; publicKey: Uint8Array }> {
        // Ensure we're connected
        await this.connect();

        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                this.pendingRequests.delete(request.requestId);
                reject(new Error("Signing request timed out"));
            }, timeoutMs);

            const pendingRequest: PendingRequest = {
                request,
                messageBytes,
                resolve,
                reject,
                timeoutId,
                createdAt: Date.now(),
            };

            this.pendingRequests.set(request.requestId, pendingRequest);

            // Send the request to the server
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                const message = {
                    type: "RegisterSigningRequest",
                    requestId: request.requestId,
                    message: request.message,
                    description: request.description,
                    origin: request.origin,
                };
                this.ws.send(JSON.stringify(message));
            }
        });
    }

    /**
     * Cancel a pending signing request
     */
    cancelRequest(requestId: string) {
        const pending = this.pendingRequests.get(requestId);
        if (pending) {
            clearTimeout(pending.timeoutId);
            this.pendingRequests.delete(requestId);

            // Notify server
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    type: "CancelSigningRequest",
                    requestId,
                }));
            }
        }
    }

    /**
     * Disconnect from the WebSocket server
     */
    disconnect() {
        if (this.ws) {
            this.ws.onclose = null; // Prevent reconnect attempts
            this.ws.close();
            this.ws = null;
        }

        // Reject all pending requests
        for (const [requestId, pending] of this.pendingRequests) {
            clearTimeout(pending.timeoutId);
            pending.reject(new Error("Service disconnected"));
            this.pendingRequests.delete(requestId);
        }
    }
}

export const qrSigningService = QRSigningService.getInstance();
