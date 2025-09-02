# Runtime Configuration with Docker

This application uses a runtime configuration solution that allows you to configure endpoints without rebuilding the Docker image.

## Environment Variables

The application uses the following environment variables:

- `NODE_BASE_URL` : Base URL of the blockchain node
- `WALLET_SERVER_BASE_URL` : Base URL of the wallet server
- `WALLET_WS_URL` : WebSocket URL of the wallet server

## Usage

### 1. Starting the container with environment variables

```bash
docker run -d \
  -p 80:80 \
  -e NODE_BASE_URL=http://your-node:8080 \
  -e WALLET_SERVER_BASE_URL=http://your-wallet-server:3000 \
  -e WALLET_WS_URL=ws://your-wallet-server:3000 \
  your-wallet-app:latest
```

### 2. Usage with docker-compose

```yaml
version: '3.8'
services:
  wallet-ui:
    image: your-wallet-app:latest
    ports:
      - "80:80"
    environment:
      - NODE_BASE_URL=http://your-node:8080
      - WALLET_SERVER_BASE_URL=http://your-wallet-server:3000
      - WALLET_WS_URL=ws://your-wallet-server:3000
```

### 3. Usage with Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: wallet-ui
spec:
  replicas: 1
  selector:
    matchLabels:
      app: wallet-ui
  template:
    metadata:
      labels:
        app: wallet-ui
    spec:
      containers:
      - name: wallet-ui
        image: your-wallet-app:latest
        ports:
        - containerPort: 80
        env:
        - name: NODE_BASE_URL
          value: "http://your-node:8080"
        - name: WALLET_SERVER_BASE_URL
          value: "http://your-wallet-server:3000"
        - name: WALLET_WS_URL
          value: "ws://your-wallet-server:3000"
```

## How it works

1. **Build** : The application is built with placeholders `${VARIABLE_NAME}` in root HTML file
2. **Runtime** : When the container starts, the `docker-entrypoint.sh` script uses `envsubst` to replace these placeholders with the actual values from environment variables
3. **Configuration** : The application reads configuration from `window.__ENV__` instead of `import.meta.env`

## Benefits

- ✅ Runtime configuration without rebuilding
- ✅ Support for different environments (dev, staging, prod)
- ✅ Compatible with orchestrators (Docker, Kubernetes)
- ✅ No source code modification required
