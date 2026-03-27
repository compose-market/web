/// <reference types="vite/client" />

interface ImportMetaEnv {
  // ThirdWeb Configuration
  readonly VITE_THIRDWEB_CLIENT_ID: string;
  
  // Treasury wallet for receiving payments
  readonly VITE_TREASURY_WALLET: `0x${string}`;
  
  // Network configuration
  readonly VITE_USE_MAINNET: string;
  
  // API endpoint (optional, defaults to same origin)
  readonly VITE_API_URL?: string;
  readonly VITE_RUNTIME_URL?: string;
  
  // Backend Services
  readonly VITE_CONNECTOR_SERVICE_URL?: string;
  readonly VITE_SANDBOX_SERVICE_URL?: string;
  readonly VITE_EXPORTER_SERVICE_URL?: string;

  // Storage and knowledge
  readonly VITE_PINATA_JWT?: string;
  readonly VITE_PINATA_GATEWAY?: string;
  readonly VITE_FILECOIN_PRIVATE_KEY?: string;
  readonly VITE_FILECOIN_RPC_URL?: string;
  readonly VITE_FILECOIN_NETWORK?: string;
  readonly VITE_MONGO_DB_API_KEY?: string;
  readonly MONGO_DB_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
