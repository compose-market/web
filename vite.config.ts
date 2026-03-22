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
    modulePreload: {
      resolveDependencies: (_url, deps) => deps.filter((dep) => !dep.includes("vendor-thirdweb")),
    },
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes("node_modules/react-dom/") || id.includes("node_modules/react/")) {
            return "vendor-react";
          }
          if (id.includes("node_modules/thirdweb/")) {
            return "vendor-thirdweb";
          }
          if (id.includes("node_modules/@radix-ui/")) {
            return "vendor-radix";
          }
          if (id.includes("node_modules/@tanstack/react-query/") || id.includes("node_modules/wouter/")) {
            return "vendor-data";
          }
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
