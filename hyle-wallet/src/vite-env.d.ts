/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SERVER_BASE_URL: string;
  readonly VITE_WS_URL: string;
  readonly VITE_NODE_BASE_URL: string;
  readonly VITE_INDEXER_BASE_URL: string;
  readonly VITE_TX_EXPLORER_URL: string;
  readonly VITE_FAUCET_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}