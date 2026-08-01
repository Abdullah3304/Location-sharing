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
const { appendLocationToSheet, sheetsConfigStatus } = require("./lib/googleSheets");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "32kb" }));

// Static frontend (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, "public")));

/**
 * Validate incoming location payload from the browser.
 * Returns an error message string, or null if valid.
 */
function validateLocationBody(body) {
  if (!body || typeof body !== "object") {
    return "Request body must be a JSON object.";
  }

  const { latitude, longitude, accuracy, timestamp } = body;

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

  return null;
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

/**
 * POST /api/locations — store a location after the user granted permission.
 * Expected body: { latitude, longitude, accuracy, timestamp }
 * Also writes Latitude, Longitude, Exact Location to Google Sheets when configured.
 */
app.post("/api/locations", async (req, res) => {
  const validationError = validateLocationBody(req.body);
  if (validationError) {
    return res.status(400).json({ ok: false, error: validationError });
  }

  try {
    const { latitude, longitude, accuracy, timestamp } = req.body;

    // Turn coordinates into a readable street-level address.
    const exactLocation = await reverseGeocode(latitude, longitude);

    const saved = await saveLocation({
      latitude,
      longitude,
      accuracy,
      timestamp,
      exactLocation,
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
