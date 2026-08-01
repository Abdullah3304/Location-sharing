/**
 * View-page logic.
 * Loads stored locations from GET /api/locations and renders a table.
 */

const refreshBtn = document.getElementById("refresh-btn");
const listStatus = document.getElementById("list-status");
const locationsBody = document.getElementById("locations-body");

/** Format a date value for display. */
function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

/** Escape text before inserting into HTML. */
function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Build one table row for a location entry. */
function rowHtml(location) {
  const { latitude, longitude, accuracy, timestamp, receivedAt } = location;
  const mapUrl = `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`;

  return `
    <tr>
      <td>${escapeHtml(formatDate(receivedAt))}</td>
      <td>${escapeHtml(Number(latitude).toFixed(6))}</td>
      <td>${escapeHtml(Number(longitude).toFixed(6))}</td>
      <td>${escapeHtml(`${Math.round(Number(accuracy))} m`)}</td>
      <td>${escapeHtml(formatDate(timestamp))}</td>
      <td><a href="${escapeHtml(mapUrl)}" target="_blank" rel="noopener noreferrer">Open map</a></td>
    </tr>
  `;
}

/** Fetch locations and update the table. */
async function loadLocations() {
  listStatus.hidden = false;
  listStatus.className = "status is-info";
  listStatus.textContent = "Loading locations…";
  refreshBtn.disabled = true;

  try {
    const response = await fetch("/api/locations");
    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Could not load locations.");
    }

    const locations = Array.isArray(data.locations) ? data.locations : [];

    if (locations.length === 0) {
      locationsBody.innerHTML = `
        <tr class="empty-row">
          <td colspan="6">No locations saved yet. <a href="/">Share one</a> to get started.</td>
        </tr>
      `;
      listStatus.className = "status is-info";
      listStatus.textContent = "No stored locations yet.";
      return;
    }

    locationsBody.innerHTML = locations.map(rowHtml).join("");
    listStatus.className = "status is-ok";
    listStatus.textContent = `Showing ${locations.length} location${locations.length === 1 ? "" : "s"}.`;
  } catch (error) {
    locationsBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="6">Unable to load locations right now.</td>
      </tr>
    `;
    listStatus.className = "status is-error";
    listStatus.textContent = error.message || "Failed to load locations.";
  } finally {
    refreshBtn.disabled = false;
  }
}

refreshBtn.addEventListener("click", loadLocations);
loadLocations();
