/**
 * Express server for the location-sharing app.
 * Serves static frontend files and exposes a small JSON API.
 * On each save: reverse-geocode + append to Google Sheets (if configured).
 */

require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");
const { getLocations, saveLocation } = require("./lib/storage");
const { reverseGeocode } = require("./lib/geocode");
const {
  normalizeCode,
  codeKey,
  listInvites,
  createInvite,
  deleteInvite,
  labelsByCode,
} = require("./lib/invites");
const {
  appendLocationToSheet,
  sheetsConfigStatus,
  fetchLatestDevicesFromSheet,
  upgradeSheetHeaders,
  createInviteInSheet,
  deleteInviteFromSheet,
  fetchInvitesFromSheet,
} = require("./lib/googleSheets");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "32kb" }));

function getAdminKey() {
  const value = process.env.ADMIN_MAP_KEY;
  return typeof value === "string" ? value.trim() : "";
}

// Static frontend (HTML, CSS, JS)
// Admin map UI is at /admin/map.html — data is gated by ADMIN_MAP_KEY on the API.
app.use(express.static(path.join(__dirname, "public")));

/**
 * Validate incoming location payload from the browser.
 * Returns an error message string, or null if valid.
 */
function validateLocationBody(body) {
  if (!body || typeof body !== "object") {
    return "Request body must be a JSON object.";
  }

  const { latitude, longitude, accuracy, timestamp, type, sessionId } = body;

  if (typeof latitude !== "number" || Number.isNaN(latitude) || latitude < -90 || latitude > 90) {
    return "latitude must be a number between -90 and 90.";
  }
  if (typeof longitude !== "number" || Number.isNaN(longitude) || longitude < -180 || longitude > 180) {
    return "longitude must be a number between -180 and 180.";
  }
  if (typeof accuracy !== "number" || Number.isNaN(accuracy) || accuracy < 0) {
    return "accuracy must be a non-negative number.";
  }
  if (typeof timestamp !== "number" || Number.isNaN(timestamp) || timestamp <= 0) {
    return "timestamp must be a positive number (ms since epoch).";
  }
  if (type != null && type !== "current" && type !== "live") {
    return 'type must be "current" or "live".';
  }
  if (sessionId != null && (typeof sessionId !== "string" || sessionId.length > 80)) {
    return "sessionId must be a short string.";
  }

  const optionalStrings = [
    ["deviceId", 80],
    ["deviceName", 80],
    ["model", 80],
    ["os", 80],
    ["browser", 40],
    ["platform", 80],
    ["screen", 40],
    ["language", 40],
    ["timezone", 80],
    ["userAgent", 320],
    ["inviteCode", 32],
  ];
  for (const [key, max] of optionalStrings) {
    const value = body[key];
    if (value != null && (typeof value !== "string" || value.length > max)) {
      return `${key} must be a string up to ${max} characters.`;
    }
  }

  return null;
}

function requireAdmin(req, res) {
  const expected = getAdminKey();
  if (!expected) {
    res.status(503).json({ ok: false, error: "ADMIN_MAP_KEY is not set." });
    return null;
  }
  const provided = String(req.query.key || req.get("x-admin-key") || "").trim();
  if (provided !== expected) {
    res.status(401).json({ ok: false, error: "Invalid admin key." });
    return null;
  }
  return expected;
}

async function loadInviteLabels() {
  const local = await labelsByCode();
  try {
    const sheet = await fetchInvitesFromSheet();
    if (sheet.ok && Array.isArray(sheet.invites)) {
      for (const invite of sheet.invites) {
        const code = normalizeCode(invite.code);
        if (!code) continue;
        if (invite.label) local[code] = String(invite.label);
        else if (!local[code]) local[code] = "";
      }
    }
  } catch (error) {
    console.warn("Sheets invites unavailable:", error.message);
  }
  return local;
}

function attachInviteLabels(devices, labels) {
  return (devices || []).map((device) => {
    const code = normalizeCode(device.inviteCode);
    const label = code ? labels[codeKey(code)] || labels[code] || "" : "";
    return {
      ...device,
      inviteCode: code || device.inviteCode || "",
      inviteLabel: label,
    };
  });
}

function pickDeviceFields(body) {
  return {
    deviceId: typeof body.deviceId === "string" ? body.deviceId : "",
    deviceName: typeof body.deviceName === "string" ? body.deviceName : "",
    model: typeof body.model === "string" ? body.model : "",
    os: typeof body.os === "string" ? body.os : "",
    browser: typeof body.browser === "string" ? body.browser : "",
    platform: typeof body.platform === "string" ? body.platform : "",
    screen: typeof body.screen === "string" ? body.screen : "",
    language: typeof body.language === "string" ? body.language : "",
    timezone: typeof body.timezone === "string" ? body.timezone : "",
    userAgent: typeof body.userAgent === "string" ? body.userAgent : "",
  };
}

/** GET /api/health — confirms env vars are visible on Vercel (no secrets). */
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    vercel: Boolean(process.env.VERCEL),
    sheets: sheetsConfigStatus(),
  });
});

/** GET /api/locations — list all stored locations */
app.get("/api/locations", async (_req, res) => {
  try {
    const locations = await getLocations();
    res.json({ ok: true, count: locations.length, locations });
  } catch (error) {
    console.error("Failed to read locations:", error);
    res.status(500).json({ ok: false, error: "Could not read stored locations." });
  }
});

function toReceivedMs(value) {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function latestDevicesFromLocal(locations) {
  const byDevice = new Map();
  for (const entry of locations) {
    const key = entry.deviceId || entry.deviceName || entry.id;
    if (!key) continue;
    const receivedMs = toReceivedMs(entry.receivedAt);
    const prev = byDevice.get(key);
    if (!prev || receivedMs >= prev.receivedMs) {
      byDevice.set(key, {
        receivedMs,
        receivedAt: entry.receivedAt,
        latitude: entry.latitude,
        longitude: entry.longitude,
        accuracy: entry.accuracy,
        exactLocation: entry.exactLocation || "",
        mapsUrl: `https://www.google.com/maps?q=${entry.latitude},${entry.longitude}`,
        type: entry.type || "current",
        sessionId: entry.sessionId || "",
        deviceId: entry.deviceId || "",
        deviceName: entry.deviceName || key,
        model: entry.model || "",
        os: entry.os || "",
        browser: entry.browser || "",
        screen: entry.screen || "",
        language: entry.language || "",
        timezone: entry.timezone || "",
        inviteCode: entry.inviteCode || "",
      });
    }
  }
  return [...byDevice.values()].map(({ receivedMs, ...device }) => device);
}

/** Keep the newest pin per device across Sheets + local JSON. */
function mergeLatestDevices(sheetDevices, localDevices) {
  const byDevice = new Map();

  function consider(device) {
    const key = device.deviceId || device.deviceName;
    if (!key) return;
    const receivedMs = toReceivedMs(device.receivedAt);
    const prev = byDevice.get(key);
    if (!prev || receivedMs >= prev.receivedMs) {
      byDevice.set(key, { ...device, receivedMs });
    }
  }

  (sheetDevices || []).forEach(consider);
  (localDevices || []).forEach(consider);

  return [...byDevice.values()].map(({ receivedMs, ...device }) => device);
}

/**
 * GET /api/admin/live?key=...
 * Latest pin per device (Sheets when available, else local JSON).
 */
app.get("/api/admin/live", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  try {
    let sheetDevices = [];
    let sheetOk = false;

    try {
      const sheetLatest = await fetchLatestDevicesFromSheet();
      if (sheetLatest.ok && Array.isArray(sheetLatest.devices)) {
        sheetDevices = sheetLatest.devices;
        sheetOk = sheetDevices.length > 0;
      }
    } catch (sheetError) {
      console.warn("Sheets latest unavailable, using local store:", sheetError.message);
    }

    const locations = await getLocations();
    const localDevices = latestDevicesFromLocal(locations);
    const labels = await loadInviteLabels();
    const devices = attachInviteLabels(
      mergeLatestDevices(sheetDevices, localDevices),
      labels
    );
    const source =
      sheetOk && localDevices.length
        ? "merged"
        : sheetOk
          ? "sheets"
          : "local";

    res.json({ ok: true, count: devices.length, source, devices });
  } catch (error) {
    console.error("Admin live map failed:", error);
    res.status(500).json({ ok: false, error: "Could not load live devices." });
  }
});

/**
 * GET /api/admin/invites?key=...
 * List invite codes (local + Sheets).
 */
app.get("/api/admin/invites", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  try {
    const byCode = new Map();
    for (const invite of await listInvites()) {
      byCode.set(codeKey(invite.code), invite);
    }
    try {
      const sheet = await fetchInvitesFromSheet();
      if (sheet.ok && Array.isArray(sheet.invites)) {
        for (const invite of sheet.invites) {
          const code = normalizeCode(invite.code);
          if (!code) continue;
          const key = codeKey(code);
          const prev = byCode.get(key);
          byCode.set(key, {
            code: prev?.code || code,
            label: invite.label || prev?.label || "",
            createdAt: invite.createdAt || prev?.createdAt || "",
          });
        }
      }
    } catch (error) {
      console.warn("Sheets invites list failed:", error.message);
    }

    const invites = [...byCode.values()].sort(
      (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
    );
    res.json({ ok: true, count: invites.length, invites });
  } catch (error) {
    console.error("List invites failed:", error);
    res.status(500).json({ ok: false, error: "Could not list invites." });
  }
});

/**
 * POST /api/admin/invites?key=...
 * Body: { code, label? } — uses YOUR code in ?c=... (not random).
 */
app.post("/api/admin/invites", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  try {
    const code =
      typeof req.body?.code === "string" ? req.body.code : "";
    const label =
      typeof req.body?.label === "string" ? req.body.label.trim().slice(0, 80) : "";
    const invite = await createInvite({ code, label });

    try {
      await createInviteInSheet(invite);
    } catch (error) {
      console.warn("Sheets invite create failed (local invite kept):", error.message);
    }

    const proto = req.get("x-forwarded-proto") || req.protocol || "https";
    const host = req.get("x-forwarded-host") || req.get("host");
    const origin = `${proto}://${host}`.replace(/\/$/, "");
    const link = `${origin}/?c=${encodeURIComponent(invite.code)}`;

    res.status(201).json({ ok: true, invite, link });
  } catch (error) {
    console.error("Create invite failed:", error);
    const status = error.statusCode || 500;
    res.status(status).json({
      ok: false,
      error: error.message || "Could not create invite.",
    });
  }
});

/**
 * DELETE /api/admin/invites/:code?key=...
 * Remove an invite code from local store (+ Sheets when available).
 */
app.delete("/api/admin/invites/:code", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  try {
    const code = normalizeCode(req.params.code);
    const result = await deleteInvite(code);

    try {
      await deleteInviteFromSheet(code);
    } catch (error) {
      console.warn("Sheets invite delete failed (local delete kept):", error.message);
    }

    res.json({ ok: true, ...result });
  } catch (error) {
    console.error("Delete invite failed:", error);
    const status = error.statusCode || 500;
    res.status(status).json({
      ok: false,
      error: error.message || "Could not delete invite.",
    });
  }
});

/**
 * POST /api/admin/upgrade-sheet?key=...
 * Asks Apps Script to rewrite the full header row (needs new Code.gs deployed).
 */
app.post("/api/admin/upgrade-sheet", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  try {
    const result = await upgradeSheetHeaders();
    res.json(result);
  } catch (error) {
    console.error("Sheet header upgrade failed:", error);
    res.status(500).json({
      ok: false,
      error: error.message,
      hint: "Paste the new google-apps-script/Code.gs and Deploy → New version first.",
    });
  }
});

/**
 * POST /api/locations — store a location after the user granted permission.
 * Expected body: { latitude, longitude, accuracy, timestamp, type?, sessionId? }
 * type "current" = first fix; "live" = watchPosition update.
 * Also writes to Google Sheets when configured.
 */
app.post("/api/locations", async (req, res) => {
  const validationError = validateLocationBody(req.body);
  if (validationError) {
    return res.status(400).json({ ok: false, error: validationError });
  }

  try {
    const {
      latitude,
      longitude,
      accuracy,
      timestamp,
      type = "current",
      sessionId = "",
    } = req.body;
    const device = pickDeviceFields(req.body);
    const inviteCode = normalizeCode(req.body.inviteCode);

    // Geocode the first fix; live pings stay as coordinates to avoid rate limits.
    const baseLocation =
      type === "live"
        ? `${latitude}, ${longitude}`
        : await reverseGeocode(latitude, longitude);

    // Match sheet style: address · Code: xxx · Device: … · ID: …
    const deviceSummary = [
      inviteCode && `Code: ${inviteCode}`,
      device.deviceName && `Device: ${device.deviceName}`,
      device.deviceId && `ID: ${device.deviceId.slice(0, 8)}`,
      device.model && device.model !== "Unknown" ? device.model : "",
      device.os,
      device.browser,
      device.screen,
    ]
      .filter(Boolean)
      .join(" · ");

    const exactLocation = deviceSummary
      ? `${baseLocation} · ${deviceSummary}`
      : baseLocation;

    const saved = await saveLocation({
      latitude,
      longitude,
      accuracy,
      timestamp,
      exactLocation,
      type,
      sessionId,
      inviteCode,
      ...device,
    });

    // Push the same row into Google Sheets (webhook or Sheets API).
    let sheets = { ok: false };
    try {
      const sheetResult = await appendLocationToSheet(saved);
      if (sheetResult?.skipped) {
        console.warn("Saved locally only — Google Sheets webhook not set.");
        sheets = { ok: false, skipped: true, reason: sheetResult.reason };
      } else {
        console.log("Appended location to Google Sheets:", sheetResult.mode);
        sheets = {
          ok: true,
          mode: sheetResult.mode,
          written: sheetResult.body?.written,
          row: sheetResult.body?.row,
        };
      }
    } catch (sheetError) {
      // Keep the API successful even if Sheets fails; data is still in JSON.
      console.error("Google Sheets append failed:", sheetError);
      sheets = { ok: false, error: sheetError.message };
    }

    res.status(201).json({ ok: true, location: saved, sheets });
  } catch (error) {
    console.error("Failed to save location:", error);
    res.status(500).json({ ok: false, error: "Could not save location." });
  }
});

// Friendly fallback for unknown API routes
app.use("/api", (_req, res) => {
  res.status(404).json({ ok: false, error: "API route not found." });
});

// Start the HTTP server when run directly (local / Render).
// When imported by Vercel, the platform invokes the exported app.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Location Sharing running at http://localhost:${PORT}`);
    if (!process.env.GOOGLE_SHEETS_WEBHOOK_URL && !process.env.GOOGLE_SHEET_ID) {
      console.log("Tip: set GOOGLE_SHEETS_WEBHOOK_URL — see GOOGLE_SHEETS_SETUP.md");
    }
  });
}

module.exports = app;
