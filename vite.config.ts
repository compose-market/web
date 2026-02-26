import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const CLIENT_PORT = 5173;
const API_PROXY_TARGET = process.env.VITE_DEV_PROXY_API_TARGET || "https://api.compose.market";
const WS_PROXY_TARGET = process.env.VITE_DEV_PROXY_WS_TARGET || "wss://api.compose.market";

export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],
  css: {
    postcss: { plugins: [] },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000, // 4MB - mermaid/thirdweb are large but already code-split
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React
          "vendor-react": ["react", "react-dom"],
          // ThirdWeb (large)
          "vendor-thirdweb": ["thirdweb"],
          // UI components
          "vendor-radix": [
            "@radix-ui/react-dialog",
            "@radix-ui/react-dropdown-menu",
            "@radix-ui/react-tabs",
            "@radix-ui/react-tooltip",
            "@radix-ui/react-select",
            "@radix-ui/react-scroll-area",
            "@radix-ui/react-avatar",
          ],
          // Query + routing
          "vendor-data": ["@tanstack/react-query", "wouter"],
        },
      },
    },
  },
  server: {
    port: CLIENT_PORT,
    strictPort: false,
    proxy: {
      "/api": {
        target: API_PROXY_TARGET,
        changeOrigin: true,
      },
      "/ws": {
        target: WS_PROXY_TARGET,
        ws: true,
      },
    },
  },
  preview: {
    port: 4173,
    strictPort: false,
  },
}));
