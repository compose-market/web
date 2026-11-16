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
  readonly VITE_AGENTS_URL?: string;
  readonly VITE_RUNTIME_URL?: string;
  
  // Backend Services
  readonly VITE_CONNECTORS_URL?: string;
  readonly VITE_CHANNELS_URL?: string;

  // NEAR Smart Contracts
  readonly VITE_NEAR_FACTORY_ADDRESS?: string;
  readonly VITE_NEAR_REPUTATION_ADDRESS?: string;
  readonly VITE_NEAR_VALIDATION_ADDRESS?: string;
  readonly VITE_NEAR_WORKFLOW_ADDRESS?: string;

  // Storage and knowledge (pinning & embeddings are proxied server-side; zero secrets in bundle)
  readonly VITE_PINATA_GATEWAY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
