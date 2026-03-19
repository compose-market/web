import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import posthog from "posthog-js";
import { PostHogProvider } from "@posthog/react";
import { initMixpanel } from "./lib/mixpanel";

initMixpanel();

posthog.init(import.meta.env.VITE_PUBLIC_POSTHOG_TOKEN, {
  api_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST,
  defaults: "2026-01-30",
});

createRoot(document.getElementById("root")!).render(
  <PostHogProvider client={posthog}>
    <App />
  </PostHogProvider>
);
