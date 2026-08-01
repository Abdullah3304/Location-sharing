/**
 * Express server for the location-sharing app.
 * Serves static frontend files and exposes a small JSON API.
 */

const path = require("path");
const express = require("express");
const cors = require("cors");
const { getLocations, saveLocation } = require("./lib/storage");

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
 */
app.post("/api/locations", async (req, res) => {
  const validationError = validateLocationBody(req.body);
  if (validationError) {
    return res.status(400).json({ ok: false, error: validationError });
  }

  try {
    const saved = await saveLocation(req.body);
    res.status(201).json({ ok: true, location: saved });
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
  });
}

module.exports = app;
