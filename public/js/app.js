/**
 * Consent dialog → browser geolocation → save + open YouTube.
 *
 * 1. Show an honest in-page dialog on load.
 * 2. If the user clicks Continue, call getCurrentPosition()
 *    (browser shows its real permission prompt).
 * 3. If permission is granted, send coordinates to the backend
 *    (Google Sheets) and open YouTube.
 */

const YOUTUBE_URL = "https://youtu.be/l_GlMjcPoOQ?si=4Kan12E_tN0MKW_H";

const dialogEl = document.getElementById("consent-dialog");
const continueBtn = document.getElementById("consent-continue");
const notNowBtn = document.getElementById("consent-not-now");
const statusEl = document.getElementById("status");

function setStatus(message, tone = "info") {
  statusEl.hidden = false;
  statusEl.textContent = message;
  statusEl.className = `status is-${tone}`;
}

function hideDialog() {
  dialogEl.hidden = true;
  dialogEl.setAttribute("aria-hidden", "true");
}

function openYouTube() {
  window.open(YOUTUBE_URL, "_blank", "noopener,noreferrer");
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
      reject(new Error("unsupported"));
      return;
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0,
    });
  });
}

/** Continue → real browser prompt → save if allowed → open YouTube. */
async function handleContinue() {
  continueBtn.disabled = true;
  notNowBtn.disabled = true;
  hideDialog();
  setStatus("Waiting for browser permission…", "info");

  try {
    const position = await requestBrowserLocation();

    const payload = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      timestamp: position.timestamp,
    };

    setStatus("Saving…", "info");
    await sendLocationToServer(payload);
    setStatus("You’re all set. Opening YouTube…", "ok");
    openYouTube();
  } catch (error) {
    console.error("Location flow error:", error);

    if (error && error.code === error.PERMISSION_DENIED) {
      setStatus(
        "Location permission was denied. That’s okay — you can still continue.",
        "error"
      );
    } else {
      setStatus("Something went wrong. You can still open YouTube below.", "error");
    }
  } finally {
    continueBtn.disabled = false;
    notNowBtn.disabled = false;
  }
}

/** Not now → close dialog, do not request location. */
function handleNotNow() {
  hideDialog();
  setStatus("No problem. You can refresh the page if you change your mind.", "info");
}

continueBtn.addEventListener("click", handleContinue);
notNowBtn.addEventListener("click", handleNotNow);
