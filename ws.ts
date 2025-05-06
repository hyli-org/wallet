import WebSocket from "ws";

class WebSocketClient {
  private ws: WebSocket | null = null;
  private reconnectAttempt = 0;
  private readonly maxReconnectDelay = 30000; // Maximum delay of 30 seconds
  private readonly baseDelay = 1000; // Start with 1 second delay
  private reconnectTimeout: NodeJS.Timeout | null = null;

  constructor(private readonly url: string) {
    this.connect();
  }

  private connect() {
    this.ws = new WebSocket(this.url);

    this.ws.on("open", () => {
      console.log("Connected to WebSocket server");
      // Reset reconnect attempt counter on successful connection
      this.reconnectAttempt = 0;
      // Send registration message
      this.ws?.send(JSON.stringify({ RegisterTopic: "new_block" }));
      this.ws?.send(JSON.stringify({ RegisterTopic: "new_tx" }));
    });

    this.ws.on("message", (data) => {
      console.log(`Received message: ${data}`);
    });

    this.ws.on("close", () => {
      console.log("Disconnected from WebSocket server");
      this.scheduleReconnect();
    });

    this.ws.on("error", (error) => {
      console.error(`WebSocket error: ${error}`);
      // Let the close event handle reconnection
    });
  }

  private scheduleReconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    // Calculate delay with exponential backoff
    const delay = this.baseDelay;
    console.log(`Attempting to reconnect in ${delay / 1000} seconds...`);

    this.reconnectTimeout = setTimeout(() => {
      console.log("Attempting to reconnect...");
      this.reconnectAttempt++;
      this.connect();
    }, delay);
  }

  // Method to manually close the connection
  public close() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    this.ws?.close();
  }
}

// Create instance
const wsClient = new WebSocketClient("ws://127.0.0.1:8080/ws");

// Handle process termination
process.on("SIGINT", () => {
  console.log("Closing WebSocket connection...");
  wsClient.close();
  process.exit(0);
});
