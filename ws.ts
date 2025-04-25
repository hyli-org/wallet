import WebSocket from "ws";

// Create a new WebSocket client and connect to a local WebSocket server
const ws = new WebSocket("ws://127.0.0.1:8080/ws");

// Event handler when the connection is opened
ws.on("open", () => {
  console.log("Connected to WebSocket server");
  // Send a message to the server
  ws.send(JSON.stringify({ RegisterTopic: "bob@wallet-d522f" }));
});

// Event handler when a message is received from the server
ws.on("message", (data) => {
  console.log(`Received message: ${data}`);
});

// Event handler when the connection is closed
ws.on("close", () => {
  console.log("Disconnected from WebSocket server");
});

// Event handler for any errors
ws.on("error", (error) => {
  console.error(`WebSocket error: ${error}`);
});
