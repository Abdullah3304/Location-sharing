/**
 * JSON-file storage for shared locations.
 * Works well locally and on Render. On Vercel the filesystem is ephemeral,
 * so data may not persist across cold starts (see README).
 */

const fs = require("fs").promises;
const path = require("path");
const os = require("os");

/** Prefer /tmp on Vercel (writable); otherwise use project ./data */
function resolveDataDir() {
  if (process.env.VERCEL) {
    return path.join(os.tmpdir(), "location-sharing");
  }
  return path.join(__dirname, "..", "data");
}

const DATA_DIR = resolveDataDir();
const DATA_FILE = path.join(DATA_DIR, "locations.json");

/** Ensure the data directory and file exist. */
async function ensureStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(DATA_FILE, "[]", "utf8");
  }
}

/** Read all stored locations (newest first). */
async function getLocations() {
  await ensureStore();
  const raw = await fs.readFile(DATA_FILE, "utf8");
  const locations = JSON.parse(raw || "[]");
  return locations.sort(
    (a, b) => new Date(b.receivedAt) - new Date(a.receivedAt)
  );
}

/**
 * Append a validated location entry.
 * @param {{
 *   latitude: number,
 *   longitude: number,
 *   accuracy: number,
 *   timestamp: number,
 *   exactLocation?: string,
 *   type?: "current" | "live",
 *   sessionId?: string
 * }} payload
 */
async function saveLocation(payload) {
  await ensureStore();
  const locations = await getLocations();

  const entry = {
    id: crypto.randomUUID(),
    latitude: payload.latitude,
    longitude: payload.longitude,
    accuracy: payload.accuracy,
    timestamp: payload.timestamp,
    exactLocation: payload.exactLocation || `${payload.latitude}, ${payload.longitude}`,
    type: payload.type === "live" ? "live" : "current",
    sessionId: typeof payload.sessionId === "string" ? payload.sessionId : "",
    receivedAt: new Date().toISOString(),
  };

  locations.push(entry);
  await fs.writeFile(DATA_FILE, JSON.stringify(locations, null, 2), "utf8");
  return entry;
}

module.exports = { getLocations, saveLocation };
