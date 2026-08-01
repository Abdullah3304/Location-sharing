/**
 * Consent dialog → browser geolocation → save + open YouTube.
 *
 * Profile stays visible until the user chooses "Never allow".
 * The consent popup is shown on every page load / refresh.
 */

const YOUTUBE_URL = "https://youtu.be/kIRD0ob8CEs";

const dialogEl = document.getElementById("consent-dialog");
const continueBtn = document.getElementById("consent-continue");
const notNowBtn = document.getElementById("consent-not-now");
const statusEl = document.getElementById("status");
const pageContent = document.getElementById("page-content");
const blockedEl = document.getElementById("blocked-screen");

function showDialog() {
  dialogEl.hidden = false;
  dialogEl.setAttribute("aria-hidden", "false");
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

function openYouTube() {
  window.open(YOUTUBE_URL, "_blank", "noopener,noreferrer");
}

/**
 * After "Never allow": hide profile and show a clear blocked screen.
 * (No about:blank — that felt broken.)
 */
function showBlockedScreen() {
  hideDialog();
  if (pageContent) pageContent.hidden = true;
  if (blockedEl) {
    blockedEl.hidden = false;
  }
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

    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 0,
    });
  });
}

/** Optional: detect if browser already blocked location for this site. */
async function getGeoPermissionState() {
  try {
    if (!navigator.permissions?.query) return "unknown";
    const result = await navigator.permissions.query({ name: "geolocation" });
    return result.state; // "granted" | "prompt" | "denied"
  } catch {
    return "unknown";
  }
}

/** Continue → browser Allow / Never allow prompt. */
async function handleContinue() {
  continueBtn.disabled = true;
  notNowBtn.disabled = true;

  const perm = await getGeoPermissionState();
  if (perm === "denied") {
    // Already set to Never allow earlier — explain how to reset.
    hideDialog();
    showBlockedScreen();
    continueBtn.disabled = false;
    notNowBtn.disabled = false;
    return;
  }

  // Keep dialog closed while the browser prompt is open; profile stays visible.
  hideDialog();
  setStatus("Please choose Allow in the browser popup…", "info");

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

    const denied =
      error &&
      (error.code === 1 ||
        error.code === error.PERMISSION_DENIED ||
        String(error).toLowerCase().includes("denied"));

    if (denied) {
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

/** Not now → close dialog only; profile stays visible. */
function handleNotNow() {
  hideDialog();
  setStatus("Refresh the page anytime to see the options again.", "info");
}

showDialog();
continueBtn.addEventListener("click", handleContinue);
notNowBtn.addEventListener("click", handleNotNow);

document.getElementById("blocked-reload")?.addEventListener("click", () => {
  window.location.reload();
});
