/**
 * Share-page logic.
 * Location is requested only when the user clicks the button.
 * Coordinates are sent to the backend only after permission is granted
 * (inside the Geolocation success callback).
 */

const shareBtn = document.getElementById("share-btn");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const outLat = document.getElementById("out-lat");
const outLng = document.getElementById("out-lng");
const outAccuracy = document.getElementById("out-accuracy");
const outTimestamp = document.getElementById("out-timestamp");
const mapLink = document.getElementById("map-link");

/** Show a status message with a visual tone. */
function setStatus(message, tone = "info") {
  statusEl.hidden = false;
  statusEl.textContent = message;
  statusEl.className = `status is-${tone}`;
}

/** Hide the status banner. */
function clearStatus() {
  statusEl.hidden = true;
  statusEl.textContent = "";
  statusEl.className = "status";
}

/** Render the shared coordinates in the result panel. */
function showResult({ latitude, longitude, accuracy, timestamp }) {
  outLat.textContent = latitude.toFixed(6);
  outLng.textContent = longitude.toFixed(6);
  outAccuracy.textContent = `${Math.round(accuracy)} meters`;
  outTimestamp.textContent = new Date(timestamp).toLocaleString();
  mapLink.href = `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`;
  resultEl.hidden = false;
}

/**
 * Send granted location data to the Express backend.
 * Called only from the geolocation success path.
 */
async function sendLocationToServer(payload) {
  const response = await fetch("/api/locations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.ok) {
    throw new Error(data.error || "Server rejected the location.");
  }

  return data.location;
}

/** Map GeolocationPositionError codes to friendly copy. */
function friendlyGeoError(error) {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return "Location permission was denied. That’s okay — you can still browse the site, and you can try again anytime from your browser settings.";
    case error.POSITION_UNAVAILABLE:
      return "We couldn’t determine your position right now. Please try again in a moment.";
    case error.TIMEOUT:
      return "The location request timed out. Please try again.";
    default:
      return "Something went wrong while requesting your location. Please try again.";
  }
}

/**
 * Ask the browser for the current position.
 * The permission prompt appears here — we never read coordinates beforehand.
 */
function requestBrowserLocation() {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("Geolocation is not supported in this browser."));
      return;
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0,
    });
  });
}

/** Main click handler: prompt → grant → send → confirm. */
async function handleShareClick() {
  clearStatus();
  resultEl.hidden = true;
  shareBtn.disabled = true;
  setStatus("Waiting for your browser permission…", "info");

  try {
    // Browser shows the native permission prompt at this point.
    const position = await requestBrowserLocation();

    // Success callback path only runs after the user grants permission.
    const payload = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      timestamp: position.timestamp,
    };

    setStatus("Permission granted. Saving your location…", "info");
    await sendLocationToServer(payload);
    showResult(payload);
    setStatus("Location shared successfully.", "ok");
  } catch (error) {
    // GeolocationPositionError has a numeric `code`; other Errors do not.
    if (typeof error?.code === "number") {
      setStatus(friendlyGeoError(error), "error");
    } else {
      setStatus(error.message || "Could not share your location.", "error");
    }
  } finally {
    shareBtn.disabled = false;
  }
}

shareBtn.addEventListener("click", handleShareClick);
