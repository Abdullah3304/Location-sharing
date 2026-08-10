/**
 * Private live map: latest pin per device, auto-refresh.
 * Open: /admin/map.html?key=YOUR_ADMIN_MAP_KEY
 */

const REFRESH_MS = 12000;
/** Last update within this → Live (green). */
const LIVE_MS = 2 * 60 * 1000;
/** Older than Live but within this → Idle (amber); older → Offline (grey). */
const IDLE_MS = 15 * 60 * 1000;

const statusEl = document.getElementById("status-line");
const listEl = document.getElementById("device-list");
const keyInput = document.getElementById("admin-key");
const refreshBtn = document.getElementById("refresh-btn");

const params = new URLSearchParams(window.location.search);
const initialKey = params.get("key") || localStorage.getItem("admin_map_key") || "";
if (initialKey) keyInput.value = initialKey;

const map = L.map("map", { zoomControl: true }).setView([31.52, 74.36], 12);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap",
}).addTo(map);

const markers = new Map();
let devices = [];
let selectedKey = "";
let timer = null;
let hasFittedBounds = false;

function setStatus(message, tone = "") {
  statusEl.textContent = message;
  statusEl.className = `status-line${tone ? ` is-${tone}` : ""}`;
}

function deviceKey(device) {
  return device.deviceId || device.deviceName || `${device.latitude},${device.longitude}`;
}

function formatWhen(value) {
  if (!value) return "unknown time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function getPresence(receivedAt) {
  const t = new Date(receivedAt).getTime();
  if (!Number.isFinite(t)) {
    return { id: "offline", label: "Offline" };
  }
  const age = Date.now() - t;
  if (age <= LIVE_MS) return { id: "live", label: "Live" };
  if (age <= IDLE_MS) return { id: "idle", label: "Idle" };
  return { id: "offline", label: "Offline" };
}

function markerIcon(statusId) {
  return L.divIcon({
    className: `device-marker is-${statusId}`,
    html: '<span class="device-marker-dot" aria-hidden="true"></span>',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -8],
  });
}

function getAdminKey() {
  return keyInput.value.trim();
}

function rememberKey(key) {
  try {
    localStorage.setItem("admin_map_key", key);
  } catch {
    /* ignore */
  }
  const next = new URL(window.location.href);
  next.searchParams.set("key", key);
  window.history.replaceState({}, "", next.toString());
  const linksLink = document.getElementById("links-link");
  if (linksLink) {
    linksLink.href = `/admin/links.html?key=${encodeURIComponent(key)}`;
  }
}

function personTitle(device) {
  if (device.inviteCode) return device.inviteCode;
  if (device.inviteLabel) return device.inviteLabel;
  return device.deviceName || "Unknown device";
}

function renderList() {
  listEl.innerHTML = "";
  if (!devices.length) {
    const empty = document.createElement("li");
    empty.className = "device-item";
    empty.textContent = "No devices yet.";
    listEl.appendChild(empty);
    return;
  }

  devices.forEach((device) => {
    const key = deviceKey(device);
    const presence = getPresence(device.receivedAt);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `device-item${key === selectedKey ? " is-active" : ""}`;
    btn.innerHTML = `
      <div class="device-item-head">
        <strong>${escapeHtml(personTitle(device))}</strong>
        <span class="presence-badge is-${presence.id}">${escapeHtml(presence.label)}</span>
      </div>
      <span>${
        device.inviteCode
          ? `Code ${escapeHtml(device.inviteCode)} · `
          : ""
      }${escapeHtml(device.deviceName || "—")} · ${escapeHtml(device.model || "—")}</span>
      <span>${escapeHtml(device.type || "current")} · ${escapeHtml(formatWhen(device.receivedAt))}</span>
      <span>${escapeHtml(device.exactLocation || `${device.latitude}, ${device.longitude}`)}</span>
    `;
    btn.addEventListener("click", () => {
      selectedKey = key;
      renderList();
      const marker = markers.get(key);
      if (marker) {
        map.setView(marker.getLatLng(), Math.max(map.getZoom(), 15), { animate: true });
        marker.openPopup();
      }
    });
    listEl.appendChild(btn);
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function syncMarkers() {
  const seen = new Set();

  devices.forEach((device) => {
    const key = deviceKey(device);
    seen.add(key);
    const presence = getPresence(device.receivedAt);
    const latLng = [device.latitude, device.longitude];
    const html = `
      <strong>${escapeHtml(personTitle(device))}</strong>
      <span class="presence-badge is-${presence.id}">${escapeHtml(presence.label)}</span><br/>
      ${
        device.inviteCode
          ? `Code: ${escapeHtml(device.inviteCode)}<br/>`
          : ""
      }
      ${escapeHtml(device.deviceName || "")} · ${escapeHtml(device.model || "")} ${escapeHtml(device.os || "")}<br/>
      ${escapeHtml(formatWhen(device.receivedAt))}<br/>
      <a href="${escapeHtml(
        device.mapsUrl || `https://www.google.com/maps?q=${device.latitude},${device.longitude}`
      )}" target="_blank" rel="noopener">Open in Google Maps</a>
    `;
    const icon = markerIcon(presence.id);

    if (markers.has(key)) {
      const marker = markers.get(key);
      marker.setLatLng(latLng);
      marker.setIcon(icon);
      marker.setPopupContent(html);
    } else {
      const marker = L.marker(latLng, { icon }).addTo(map).bindPopup(html);
      markers.set(key, marker);
    }
  });

  for (const [key, marker] of markers.entries()) {
    if (!seen.has(key)) {
      map.removeLayer(marker);
      markers.delete(key);
    }
  }

  // Fit once (or when jumping to a selected device) so pins can move visibly on refresh.
  if (devices.length && !hasFittedBounds) {
    const group = L.featureGroup([...markers.values()]);
    map.fitBounds(group.getBounds().pad(0.2));
    hasFittedBounds = true;
  }
}

async function loadDevices() {
  const key = getAdminKey();
  if (!key) {
    setStatus("Enter admin key to load devices.", "error");
    return;
  }

  rememberKey(key);
  setStatus("Loading…");

  try {
    const response = await fetch(`/api/admin/live?key=${encodeURIComponent(key)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    devices = Array.isArray(data.devices) ? data.devices : [];
    syncMarkers();
    renderList();
    setStatus(
      `${devices.length} device${devices.length === 1 ? "" : "s"} · source: ${data.source || "api"} · ${new Date().toLocaleTimeString()}`,
      "ok"
    );
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Failed to load devices", "error");
  }
}

function startAutoRefresh() {
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    if (getAdminKey()) loadDevices();
  }, REFRESH_MS);
}

refreshBtn.addEventListener("click", () => {
  loadDevices();
});

keyInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") loadDevices();
});

if (initialKey) {
  rememberKey(initialKey);
  loadDevices();
  startAutoRefresh();
} else {
  startAutoRefresh();
}
