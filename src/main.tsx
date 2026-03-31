import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/index.css";
import posthog from "posthog-js";
import { PostHogProvider } from "@posthog/react";
import { initMixpanel } from "./lib/mixpanel";

function scheduleAnalyticsBootstrap(callback: () => void) {
  if (typeof window === "undefined") {
    return;
  }

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(callback, { timeout: 2_000 });
    return;
  }

  globalThis.setTimeout(callback, 1_500);
}

scheduleAnalyticsBootstrap(() => {
  void initMixpanel();

  if (!import.meta.env.VITE_PUBLIC_POSTHOG_TOKEN) {
    return;
  }

  posthog.init(import.meta.env.VITE_PUBLIC_POSTHOG_TOKEN, {
    api_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST,
    defaults: "2026-01-30",
  });
});

createRoot(document.getElementById("root")!).render(
  <PostHogProvider client={posthog}>
    <App />
  </PostHogProvider>
);
