/**
 * Append a location row to Google Sheets via Apps Script webhook
 * (or optionally via the Sheets API with a service account).
 *
 * Uses Node's https module (not fetch) so Apps Script 302 + Location
 * headers work reliably on Vercel serverless.
 */

const https = require("https");
const { URL } = require("url");

function env(name) {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : value;
}

/**
 * @param {{
 *   latitude: number,
 *   longitude: number,
 *   accuracy: number,
 *   timestamp: number,
 *   receivedAt: string,
 *   exactLocation: string
 * }} entry
 */
async function appendLocationToSheet(entry) {
  const webhookUrl = env("GOOGLE_SHEETS_WEBHOOK_URL");

  if (webhookUrl) {
    return appendViaWebhook(webhookUrl, entry);
  }

  const email = env("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const privateKey = env("GOOGLE_PRIVATE_KEY")?.replace(/\\n/g, "\n");
  const sheetId = env("GOOGLE_SHEET_ID");

  if (email && privateKey && sheetId) {
    return appendViaSheetsApi({ email, privateKey, sheetId }, entry);
  }

  console.warn(
    "Google Sheets not configured. Set GOOGLE_SHEETS_WEBHOOK_URL on Vercel env vars, then redeploy."
  );
  return { skipped: true, reason: "GOOGLE_SHEETS_WEBHOOK_URL is missing" };
}

/** Low-level HTTPS request that never auto-follows redirects. */
function httpsRequest(method, urlString, { headers = {}, body = null } = {}) {
  const url = new URL(urlString);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );

    req.setTimeout(20000, () => {
      req.destroy(new Error("Google Sheets request timed out"));
    });
    req.on("error", reject);

    if (body != null) {
      req.write(body);
    }
    req.end();
  });
}

/**
 * Google Apps Script web apps:
 * 1) POST /exec → processes doPost, returns 302 to echo URL
 * 2) GET echo URL → JSON result ({ ok, written, ... })
 */
/** Spreadsheet IDs look like 1dfwgTvgl8... — not Apps Script IDs (AKfyc...). */
function resolveSpreadsheetId() {
  const sheetId = env("GOOGLE_SHEET_ID");
  if (!sheetId) return undefined;
  if (sheetId.startsWith("AKfyc") || sheetId.includes("/")) {
    console.warn(
      "GOOGLE_SHEET_ID looks invalid (Apps Script ID?). Ignoring it; Apps Script will use the bound spreadsheet."
    );
    return undefined;
  }
  return sheetId;
}

async function appendViaWebhook(webhookUrl, entry) {
  const sheetId = resolveSpreadsheetId();
  const payload = JSON.stringify({
    receivedAt: entry.receivedAt,
    latitude: entry.latitude,
    longitude: entry.longitude,
    accuracy: entry.accuracy,
    exactLocation: entry.exactLocation,
    timestamp: entry.timestamp,
    type: entry.type || "current",
    sessionId: entry.sessionId || "",
    deviceId: entry.deviceId || "",
    deviceName: entry.deviceName || "",
    model: entry.model || "",
    os: entry.os || "",
    browser: entry.browser || "",
    platform: entry.platform || "",
    screen: entry.screen || "",
    language: entry.language || "",
    timezone: entry.timezone || "",
    userAgent: entry.userAgent || "",
    mapsUrl: `https://www.google.com/maps?q=${entry.latitude},${entry.longitude}`,
    spreadsheetId: sheetId || undefined,
  });

  const headers = {
    "Content-Type": "text/plain;charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  };

  const first = await httpsRequest("POST", webhookUrl, { headers, body: payload });

  if (first.status === 200) {
    return parseWebhookResponse(first.body);
  }

  if (first.status < 300 || first.status >= 400) {
    throw new Error(
      `Sheets webhook POST failed (${first.status}): ${first.body.slice(0, 240)}`
    );
  }

  const echoUrl = first.headers.location;
  if (!echoUrl) {
    // POST often still wrote the row even if Location is missing.
    console.warn("Apps Script 302 without Location; assuming write succeeded.");
    return { ok: true, mode: "webhook", body: { ok: true, assumed: true } };
  }

  const second = await httpsRequest("GET", echoUrl);
  // Apps Script often writes on POST, then echo URL returns another 302.
  // Treat that as success so localhost/Vercel don't falsely report Sheets failure.
  if (second.status >= 300 && second.status < 400) {
    console.warn("Apps Script echo redirected; assuming write succeeded.");
    return { ok: true, mode: "webhook", body: { ok: true, assumed: true } };
  }
  if (second.status < 200 || second.status >= 300) {
    throw new Error(
      `Sheets webhook echo failed (${second.status}): ${second.body.slice(0, 240)}`
    );
  }

  return parseWebhookResponse(second.body);
}

function parseWebhookResponse(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Sheets webhook returned non-JSON: ${text.slice(0, 240)}`);
  }

  if (typeof data.message === "string" && data.message.includes("webhook is live")) {
    throw new Error(
      "Apps Script ran doGet() instead of doPost(). Redeploy the web app as /exec with Anyone access."
    );
  }

  if (data.ok === false) {
    throw new Error(`Sheets webhook error: ${data.error || text}`);
  }

  return { ok: true, mode: "webhook", body: data };
}

async function appendViaSheetsApi({ email, privateKey, sheetId }, entry) {
  const { google } = require("googleapis");

  const auth = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  const tab = env("GOOGLE_SHEET_TAB") || "Locations";
  const mapsUrl = `https://www.google.com/maps?q=${entry.latitude},${entry.longitude}`;

  const headers = [
    "Received At",
    "Latitude",
    "Longitude",
    "Accuracy (m)",
    "Exact Location",
    "Device Timestamp",
    "Google Maps",
    "Type",
    "Session ID",
    "Device ID",
    "Device Name",
    "Model",
    "OS",
    "Browser",
    "Screen",
    "Language",
    "Timezone",
    "User Agent",
  ];
  const headerRange = `${tab}!A1:R1`;
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: headerRange,
  });

  if (!existing.data.values || existing.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: headerRange,
      valueInputOption: "RAW",
      requestBody: {
        values: [headers],
      },
    });
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `${tab}!A:R`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [
        [
          entry.receivedAt,
          entry.latitude,
          entry.longitude,
          entry.accuracy,
          entry.exactLocation,
          new Date(entry.timestamp).toISOString(),
          mapsUrl,
          entry.type || "current",
          entry.sessionId || "",
          entry.deviceId || "",
          entry.deviceName || "",
          entry.model || "",
          entry.os || "",
          entry.browser || "",
          entry.screen || "",
          entry.language || "",
          entry.timezone || "",
          entry.userAgent || "",
        ],
      ],
    },
  });

  return { ok: true, mode: "sheets-api" };
}

/** Safe status for /api/health — never exposes secret values. */
function sheetsConfigStatus() {
  return {
    webhookConfigured: Boolean(env("GOOGLE_SHEETS_WEBHOOK_URL")),
    sheetIdConfigured: Boolean(env("GOOGLE_SHEET_ID")),
  };
}

module.exports = { appendLocationToSheet, sheetsConfigStatus };
