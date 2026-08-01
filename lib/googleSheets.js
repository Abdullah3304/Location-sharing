/**
 * Append a location row to Google Sheets via Apps Script webhook
 * (or optionally via the Sheets API with a service account).
 */

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
  const webhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK_URL;

  if (webhookUrl) {
    return appendViaWebhook(webhookUrl, entry);
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const sheetId = process.env.GOOGLE_SHEET_ID;

  if (email && privateKey && sheetId) {
    return appendViaSheetsApi({ email, privateKey, sheetId }, entry);
  }

  console.warn(
    "Google Sheets not configured. Set GOOGLE_SHEETS_WEBHOOK_URL (see GOOGLE_SHEETS_SETUP.md)."
  );
  return { skipped: true };
}

/**
 * Google Apps Script web apps respond to POST with a 302.
 * The row is written during that POST. A GET to the redirect URL
 * returns the JSON result. Auto-following as POST→GET on the wrong
 * step (or re-POSTing the echo URL) breaks the flow.
 */
async function appendViaWebhook(webhookUrl, entry) {
  const payload = JSON.stringify({
    receivedAt: entry.receivedAt,
    latitude: entry.latitude,
    longitude: entry.longitude,
    accuracy: entry.accuracy,
    exactLocation: entry.exactLocation,
    timestamp: entry.timestamp,
    mapsUrl: `https://www.google.com/maps?q=${entry.latitude},${entry.longitude}`,
    // Optional: pin writes to a specific spreadsheet
    spreadsheetId: process.env.GOOGLE_SHEET_ID || undefined,
  });

  const headers = { "Content-Type": "text/plain;charset=utf-8" };

  const first = await fetch(webhookUrl, {
    method: "POST",
    headers,
    body: payload,
    redirect: "manual",
  });

  // Some environments return JSON directly (no redirect).
  if (first.status === 200) {
    return parseWebhookResponse(await first.text());
  }

  if (first.status < 300 || first.status >= 400) {
    const text = await first.text();
    throw new Error(`Sheets webhook POST failed (${first.status}): ${text.slice(0, 240)}`);
  }

  const echoUrl = first.headers.get("location");
  if (!echoUrl) {
    throw new Error("Apps Script redirect missing Location header");
  }

  // Retrieve doPost() result — must be GET on the echo URL.
  const second = await fetch(echoUrl, {
    method: "GET",
    redirect: "follow",
  });
  const text = await second.text();

  if (!second.ok) {
    throw new Error(`Sheets webhook echo failed (${second.status}): ${text.slice(0, 240)}`);
  }

  return parseWebhookResponse(text);
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
      "Apps Script ran doGet() instead of doPost(). Update Code.gs and redeploy the web app."
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
  const tab = process.env.GOOGLE_SHEET_TAB || "Locations";
  const mapsUrl = `https://www.google.com/maps?q=${entry.latitude},${entry.longitude}`;

  const headerRange = `${tab}!A1:G1`;
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
        values: [
          [
            "Received At",
            "Latitude",
            "Longitude",
            "Accuracy (m)",
            "Exact Location",
            "Device Timestamp",
            "Google Maps",
          ],
        ],
      },
    });
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `${tab}!A:G`,
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
        ],
      ],
    },
  });

  return { ok: true, mode: "sheets-api" };
}

module.exports = { appendLocationToSheet };
