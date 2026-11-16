if (typeof window !== "undefined") {
  // Thirdweb's InAppWebConnector unconditionally constructs InAppWalletIframeCommunicator
  // for legacy 2022 sharded wallets even when using modern EnclaveWallets (passkey/OAuth/email).
  // Appending that cross-origin <iframe id="thirdweb-in-app-wallet-iframe"> triggers 19
  // cross-origin Next.js asset requests and causes browser extensions with all_frames: true
  // (e.g. MetaMask / Phantom contentscript.js) to re-inject and block the main thread (~300ms).
  const detachedThirdwebIframes = new Map<string, HTMLElement>();
  const origAppendChild = Node.prototype.appendChild;
  Node.prototype.appendChild = function <T extends Node>(newChild: T): T {
    if (
      newChild instanceof HTMLIFrameElement &&
      typeof newChild.id === "string" &&
      newChild.id.startsWith("thirdweb-in-app-wallet-iframe")
    ) {
      detachedThirdwebIframes.set(newChild.id, newChild);
      return newChild;
    }
    return origAppendChild.call(this, newChild) as T;
  };
  const origGetElementById = Document.prototype.getElementById;
  Document.prototype.getElementById = function (elementId: string): HTMLElement | null {
    if (typeof elementId === "string" && detachedThirdwebIframes.has(elementId)) {
      return detachedThirdwebIframes.get(elementId) ?? null;
    }
    return origGetElementById.call(this, elementId);
  };
}

import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/index.css";

createRoot(document.getElementById("root")!).render(<App />);
