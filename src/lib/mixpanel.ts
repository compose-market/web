/**
 * Mixpanel Analytics Wrapper
 *
 * Uses the npm `mixpanel-browser` package.
 * Initialised once at app startup via `initMixpanel()`.
 * All helpers no-op gracefully if init was skipped (e.g. missing token).
 */
import mixpanel from "mixpanel-browser";

const MIXPANEL_TOKEN = import.meta.env.VITE_MIXPANEL_TOKEN as string;

let initialised = false;

export function initMixpanel(): void {
  if (initialised) return;
  if (!MIXPANEL_TOKEN) {
    console.warn("[Mixpanel] VITE_MIXPANEL_TOKEN is not set, skipping init");
    return;
  }
  mixpanel.init(MIXPANEL_TOKEN, {
    debug: import.meta.env.DEV,
    track_pageview: true,
    persistence: "localStorage",
    record_sessions_percent: 100,
    record_heatmap_data: true,
    ignore_dnt: true,
  });
  initialised = true;
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
  if (!initialised) return;
  mixpanel.identify(userAddress);
  mixpanel.people.set({
    $name: userAddress,
    user_address: userAddress,
  });

  const seen = localStorage.getItem(FIRST_SEEN_KEY);
  if (!seen) {
    localStorage.setItem(FIRST_SEEN_KEY, "1");
    mixpanel.track("Sign Up", {
      user_id: userAddress,
      signup_method: "wallet",
    });
  } else {
    mixpanel.track("Sign In", {
      user_id: userAddress,
      login_method: "wallet",
      success: true,
    });
  }
}

/** Reset identity on wallet disconnect. */
export function mpReset(): void {
  if (!initialised) return;
  mixpanel.reset();
}

// ---------------------------------------------------------------------------
// Typed event helpers
// ---------------------------------------------------------------------------

/** Generic track wrapper — keeps call-sites clean. */
export function mpTrack(
  eventName: string,
  properties?: Record<string, unknown>,
): void {
  if (!initialised) return;
  mixpanel.track(eventName, properties);
}

/** Track an error event. */
export function mpError(
  errorType: string,
  errorMessage: string,
  extra?: Record<string, unknown>,
): void {
  if (!initialised) return;
  mixpanel.track("Error", {
    error_type: errorType,
    error_message: errorMessage,
    page_url: window.location.href,
    ...extra,
  });
}
