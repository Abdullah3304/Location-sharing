/**
 * PinTrail → Google Sheets receiver
 *
 * === UPGRADE (required for Device ID / Name / Type columns) ===
 * 1) Open your Location Sharing spreadsheet
 * 2) Extensions → Apps Script
 * 3) Replace ALL code with this file → Save
 * 4) Select UPGRADE_HEADERS_NOW → Run → Allow permissions
 *    (Header row expands to include Type, Session ID, Device columns)
 * 5) Deploy → Manage deployments → pencil (Edit) → Version: New version
 *    → Execute as: Me → Who has access: Anyone → Deploy
 * 6) Keep the same /exec URL in .env / Vercel (no change needed if URL stays)
 */

var SHEET_NAME = "Locations";
var HEADERS = [
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

/** Run once after pasting this script to expand the header row. */
function UPGRADE_HEADERS_NOW() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error("Open this script from the Google Sheet (Extensions → Apps Script).");
  }
  var sheet = getOrCreateSheet_(ss);
  ensureHeaders_(sheet);
  Logger.log("Headers updated on tab: " + sheet.getName());
  Logger.log("Columns: " + HEADERS.join(" | "));
}

/** Optional: write a full test row with device columns. */
function TEST_WRITE_NOW() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error("Open this script from a Google Sheet (Extensions → Apps Script).");
  }
  var sheet = getOrCreateSheet_(ss);
  ensureHeaders_(sheet);
  sheet.appendRow([
    new Date().toISOString(),
    11.11,
    22.22,
    1,
    "TEST_WRITE_NOW — script is linked to THIS spreadsheet",
    new Date().toISOString(),
    "https://www.google.com/maps?q=11.11,22.22",
    "current",
    "test-session",
    "test-device-id",
    "Phone-TEST01",
    "TestModel",
    "Android",
    "Chrome",
    "1080x2400@3x",
    "en",
    "Asia/Karachi",
    "TEST_UA",
  ]);
  Logger.log("Wrote test row to: " + ss.getUrl());
}

function doPost(e) {
  try {
    var raw = e && e.postData && e.postData.contents ? e.postData.contents : "{}";
    var data = JSON.parse(raw);

    var ss = openSpreadsheet_(data);
    var sheet = getOrCreateSheet_(ss);
    ensureHeaders_(sheet);

    var mapsUrl =
      data.mapsUrl ||
      "https://www.google.com/maps?q=" + data.latitude + "," + data.longitude;

    sheet.appendRow([
      data.receivedAt || new Date().toISOString(),
      Number(data.latitude),
      Number(data.longitude),
      Number(data.accuracy),
      data.exactLocation || "",
      data.timestamp ? new Date(Number(data.timestamp)).toISOString() : "",
      mapsUrl,
      data.type || "current",
      data.sessionId || "",
      data.deviceId || "",
      data.deviceName || "",
      data.model || "",
      data.os || "",
      data.browser || "",
      data.screen || "",
      data.language || "",
      data.timezone || "",
      data.userAgent || "",
    ]);

    return json_({
      ok: true,
      written: true,
      sheet: sheet.getName(),
      row: sheet.getLastRow(),
      spreadsheetName: ss.getName(),
      spreadsheetUrl: ss.getUrl(),
    });
  } catch (error) {
    return json_({ ok: false, error: String(error) });
  }
}

/**
 * GET ?action=latest  → latest row per Device ID (for admin live map)
 * GET ?action=upgrade → rewrite header row
 * GET (default)       → health ping
 */
function doGet(e) {
  try {
    var action = e && e.parameter && e.parameter.action ? String(e.parameter.action) : "";
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss && e && e.parameter && e.parameter.spreadsheetId) {
      ss = SpreadsheetApp.openById(String(e.parameter.spreadsheetId));
    }
    if (!ss) {
      return json_({ ok: false, error: "No spreadsheet bound to this script." });
    }

    if (action === "upgrade") {
      var upgradeSheet = getOrCreateSheet_(ss);
      ensureHeaders_(upgradeSheet);
      return json_({
        ok: true,
        upgraded: true,
        headers: HEADERS,
        sheet: upgradeSheet.getName(),
      });
    }

    if (action === "latest") {
      return json_(getLatestDevices_(ss));
    }

    return json_({
      ok: true,
      message: "PinTrail Sheets webhook is live. POST location JSON here.",
      spreadsheetName: ss.getName(),
      spreadsheetUrl: ss.getUrl(),
      actions: ["latest", "upgrade"],
    });
  } catch (error) {
    return json_({ ok: false, error: String(error) });
  }
}

function getLatestDevices_(ss) {
  var sheet = getOrCreateSheet_(ss);
  ensureHeaders_(sheet);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return { ok: true, count: 0, devices: [] };
  }

  var width = HEADERS.length;
  var values = sheet.getRange(2, 1, lastRow, width).getValues();
  var byDevice = {};

  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var lat = Number(row[1]);
    var lng = Number(row[2]);
    if (!isFinite(lat) || !isFinite(lng)) continue;

    var deviceId = String(row[9] || "").trim();
    var deviceName = String(row[10] || "").trim();
    var key = deviceId || deviceName || "unknown-" + i;
    var receivedAt = row[0] ? String(row[0]) : "";

    var entry = {
      receivedAt: receivedAt,
      latitude: lat,
      longitude: lng,
      accuracy: Number(row[3]) || 0,
      exactLocation: String(row[4] || ""),
      mapsUrl: String(row[6] || ""),
      type: String(row[7] || "current"),
      sessionId: String(row[8] || ""),
      deviceId: deviceId,
      deviceName: deviceName || key,
      model: String(row[11] || ""),
      os: String(row[12] || ""),
      browser: String(row[13] || ""),
      screen: String(row[14] || ""),
      language: String(row[15] || ""),
      timezone: String(row[16] || ""),
    };

    var prev = byDevice[key];
    if (!prev || String(entry.receivedAt) >= String(prev.receivedAt)) {
      byDevice[key] = entry;
    }
  }

  var devices = Object.keys(byDevice).map(function (k) {
    return byDevice[k];
  });

  return { ok: true, count: devices.length, devices: devices };
}

function openSpreadsheet_(data) {
  if (data && data.spreadsheetId) {
    return SpreadsheetApp.openById(String(data.spreadsheetId));
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error(
      "No active spreadsheet. Open Apps Script from the Google Sheet, then redeploy."
    );
  }
  return ss;
}

function getOrCreateSheet_(ss) {
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    var first = ss.getSheets()[0];
    if (first.getName() === "Sheet1" && first.getLastRow() <= 1) {
      first.setName(SHEET_NAME);
      sheet = first;
    } else {
      sheet = ss.insertSheet(SHEET_NAME);
    }
  }
  return sheet;
}

function ensureHeaders_(sheet) {
  var width = HEADERS.length;
  sheet.getRange(1, 1, 1, width).setValues([HEADERS]);
  sheet.setFrozenRows(1);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
