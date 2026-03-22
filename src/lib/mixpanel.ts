/**
 * Mixpanel Analytics Wrapper
 *
 * Lazily loads `mixpanel-browser` so the analytics runtime doesn't sit on the
 * critical path for the initial app shell.
 */

const MIXPANEL_TOKEN = import.meta.env.VITE_MIXPANEL_TOKEN as string;
const MIXPANEL_RECORD_SESSIONS_PERCENT = Number.parseInt(
  import.meta.env.VITE_MIXPANEL_RECORD_SESSIONS_PERCENT || "0",
  10,
);
const MIXPANEL_ENABLE_HEATMAPS = import.meta.env.VITE_MIXPANEL_ENABLE_HEATMAPS === "true";

let initialised = false;
let mixpanelClient: typeof import("mixpanel-browser").default | null = null;
let initPromise: Promise<void> | null = null;

async function getMixpanelClient() {
  if (mixpanelClient) {
    return mixpanelClient;
  }

  const module = await import("mixpanel-browser");
  mixpanelClient = module.default;
  return mixpanelClient;
}

export function initMixpanel(): Promise<void> {
  if (initialised) {
    return Promise.resolve();
  }
  if (initPromise) {
    return initPromise;
  }
  if (!MIXPANEL_TOKEN) {
    return Promise.resolve();
  }

  initPromise = getMixpanelClient()
    .then((mixpanel) => {
      mixpanel.init(MIXPANEL_TOKEN, {
        debug: import.meta.env.DEV,
        track_pageview: true,
        persistence: "localStorage",
        record_sessions_percent: Number.isFinite(MIXPANEL_RECORD_SESSIONS_PERCENT)
          ? Math.min(Math.max(MIXPANEL_RECORD_SESSIONS_PERCENT, 0), 100)
          : 0,
        record_heatmap_data: MIXPANEL_ENABLE_HEATMAPS,
        ignore_dnt: true,
      });
      initialised = true;
    })
    .finally(() => {
      initPromise = null;
    });

  return initPromise;
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

const FIRST_SEEN_KEY = "mp_compose_first_seen";

/**
 * Identify user by wallet address.
 * Detects first-time vs returning users for Sign Up / Sign In events.
 */
export function mpIdentify(userAddress: string): void {
  if (!initialised || !mixpanelClient) return;
  mixpanelClient.identify(userAddress);
  mixpanelClient.people.set({
    $name: userAddress,
    user_address: userAddress,
  });

  const seen = localStorage.getItem(FIRST_SEEN_KEY);
  if (!seen) {
    localStorage.setItem(FIRST_SEEN_KEY, "1");
    mixpanelClient.track("Sign Up", {
      user_id: userAddress,
      signup_method: "wallet",
    });
  } else {
    mixpanelClient.track("Sign In", {
      user_id: userAddress,
      login_method: "wallet",
      success: true,
    });
  }
}

/** Reset identity on wallet disconnect. */
export function mpReset(): void {
  if (!initialised || !mixpanelClient) return;
  mixpanelClient.reset();
}

// ---------------------------------------------------------------------------
// Typed event helpers
// ---------------------------------------------------------------------------

/** Generic track wrapper — keeps call-sites clean. */
export function mpTrack(
  eventName: string,
  properties?: Record<string, unknown>,
): void {
  if (!initialised || !mixpanelClient) return;
  mixpanelClient.track(eventName, properties);
}

/** Track an error event. */
export function mpError(
  errorType: string,
  errorMessage: string,
  extra?: Record<string, unknown>,
): void {
  if (!initialised || !mixpanelClient) return;
  mixpanelClient.track("Error", {
    error_type: errorType,
    error_message: errorMessage,
    page_url: window.location.href,
    ...extra,
  });
}
