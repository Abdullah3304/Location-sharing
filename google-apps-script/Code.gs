/**
 * PinTrail → Google Sheets receiver
 *
 * === UPGRADE (required for Invite Code + Invites tab) ===
 * 1) Open your Location Sharing spreadsheet
 * 2) Extensions → Apps Script
 * 3) Replace ALL code with this file → Save
 * 4) Select UPGRADE_HEADERS_NOW → Run → Allow permissions
 * 5) Deploy → Manage deployments → pencil (Edit) → Version: New version
 *    → Execute as: Me → Who has access: Anyone → Deploy
 * 6) Keep the same /exec URL in .env / Vercel
 */

var SHEET_NAME = "Locations";
var INVITES_SHEET = "Invites";
// Invite Code first. No Received At / Language / User Agent.
var HEADERS = [
  "Invite Code",
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
  "Timezone",
];
var OBSOLETE_HEADERS = ["Received At", "Language", "User Agent"];
var INVITE_HEADERS = ["Code", "Label", "Created At"];
var LAHORE_TZ = "Asia/Karachi";

/** Format any instant as Lahore local time for the sheet (readable, not UTC). */
function formatLahore_(value) {
  if (value === "" || value == null) return "";
  var date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return String(value);
  return Utilities.formatDate(date, LAHORE_TZ, "yyyy-MM-dd HH:mm:ss");
}

/** Prefer payload inviteCode; else parse [code] or Code: xxx from Exact Location. */
function resolveInviteCode_(data) {
  var code = String((data && data.inviteCode) || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 32);
  if (code) return code;
  var exact = String((data && data.exactLocation) || "");
  var bracket = exact.match(/^\[([a-zA-Z0-9_-]+)\]/);
  if (bracket) return bracket[1];
  var match = exact.match(/Code:\s*([a-zA-Z0-9_-]+)/i);
  return match ? match[1] : "";
}

function findHeaderCol_(sheet, headerName) {
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i] || "").trim() === headerName) return i + 1;
  }
  return -1;
}

/** Plain text cell — stops Sheets turning Lahore time into a UTC Date. */
function setTextCell_(sheet, row, col, value) {
  if (!col || col < 1) return;
  var cell = sheet.getRange(row, col);
  cell.setNumberFormat("@");
  cell.setValue(value == null ? "" : String(value));
}

function setCell_(sheet, row, col, value) {
  if (!col || col < 1) return;
  sheet.getRange(row, col).setValue(value);
}

/**
 * Make sure column A is Invite Code. Inserts a new first column when needed
 * so existing data shifts right instead of getting mis-labeled.
 */
function ensureInviteCodeFirstColumn_(sheet) {
  var first = String(sheet.getRange(1, 1).getValue() || "").trim();
  if (first === "Invite Code") return;
  var existing = findHeaderCol_(sheet, "Invite Code");
  sheet.insertColumnBefore(1);
  if (existing > 0) {
    // Old invite column shifted by +1; clear its header to avoid duplicates.
    sheet.getRange(1, existing + 1).setValue("");
  }
}

/** Delete columns the user no longer wants (Received At, Language, User Agent). */
function removeObsoleteColumns_(sheet) {
  for (var i = sheet.getLastColumn(); i >= 1; i--) {
    var name = String(sheet.getRange(1, i).getValue() || "").trim();
    if (OBSOLETE_HEADERS.indexOf(name) !== -1) {
      sheet.deleteColumn(i);
    }
  }
}

/** Write one cell by header name on an existing row. */
function writeByHeader_(sheet, rowNumber, headerName, value) {
  var col = findHeaderCol_(sheet, headerName);
  if (col < 1) return false;
  setTextCell_(sheet, rowNumber, col, value);
  return true;
}

function lahoreText_(data, isoField, displayField, fallbackDate) {
  if (data && data[displayField]) return String(data[displayField]);
  var raw = data && data[isoField] != null ? data[isoField] : fallbackDate;
  if (raw === "" || raw == null) return "";
  var formatted = formatLahore_(typeof raw === "number" ? new Date(Number(raw)) : raw);
  return formatted ? formatted + " PKT" : "";
}

/**
 * One-time: fill empty Invite Code cells from Exact Location "Code: xxx".
 * Select BACKFILL_INVITE_CODES_NOW → Run
 */
function BACKFILL_INVITE_CODES_NOW() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error("Open this script from the Google Sheet (Extensions → Apps Script).");
  }
  var sheet = getOrCreateSheet_(ss);
  ensureInviteCodeFirstColumn_(sheet);
  ensureHeaders_(sheet);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log("No data rows.");
    return;
  }
  var inviteCol = findHeaderCol_(sheet, "Invite Code");
  var exactCol = findHeaderCol_(sheet, "Exact Location");
  if (inviteCol < 1) {
    throw new Error('No "Invite Code" header. Run UPGRADE_HEADERS_NOW first.');
  }
  if (exactCol < 1) exactCol = 6;

  var values = sheet.getRange(2, exactCol, lastRow, exactCol).getValues();
  var filled = 0;
  for (var r = 0; r < values.length; r++) {
    var existing = String(sheet.getRange(r + 2, inviteCol).getValue() || "").trim();
    if (existing) continue;
    var exact = String(values[r][0] || "");
    var match =
      exact.match(/\[([a-zA-Z0-9_-]+)\]/) ||
      exact.match(/Code:\s*([a-zA-Z0-9_-]+)/i);
    if (!match) continue;
    setTextCell_(sheet, r + 2, inviteCol, match[1]);
    filled += 1;
  }
  Logger.log("Filled Invite Code on " + filled + " row(s).");
}

/** Run once after pasting this script to expand the header row. */
function UPGRADE_HEADERS_NOW() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error("Open this script from the Google Sheet (Extensions → Apps Script).");
  }
  ss.setSpreadsheetTimeZone(LAHORE_TZ);
  var sheet = getOrCreateSheet_(ss);
  ensureInviteCodeFirstColumn_(sheet);
  removeObsoleteColumns_(sheet);
  ensureHeaders_(sheet);
  ensureInviteSheet_(ss);
  BACKFILL_INVITE_CODES_NOW();
  Logger.log("Headers updated on tab: " + sheet.getName());
  Logger.log("Timezone: " + LAHORE_TZ);
  Logger.log("Columns: " + HEADERS.join(" | "));
  Logger.log("Removed: Received At, Language, User Agent. Lat=B, Lng=C.");
}

/** Optional: write a full test row with device columns. */
function TEST_WRITE_NOW() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error("Open this script from a Google Sheet (Extensions → Apps Script).");
  }
  var sheet = getOrCreateSheet_(ss);
  ensureInviteCodeFirstColumn_(sheet);
  ensureHeaders_(sheet);
  writeLocationRow_(sheet, {
    inviteCode: "TEST01",
    latitude: 31.41326267,
    longitude: 74.25513083,
    accuracy: 38,
    exactLocation:
      "Valencia · Code: TEST01 · Device: Phone-TEST01 · ID: test01 · Android · Chrome",
    timestamp: Date.now(),
    mapsUrl: "https://www.google.com/maps?q=31.41326267,74.25513083",
    type: "current",
    sessionId: "test-session",
    deviceId: "test-device-id",
    deviceName: "Phone-TEST01",
    model: "TestModel",
    os: "Android",
    browser: "Chrome",
    screen: "1080x2400@3x",
    timezone: "Asia/Karachi",
  });
  Logger.log("Wrote test row to: " + ss.getUrl());
}

function doPost(e) {
  try {
    var raw = e && e.postData && e.postData.contents ? e.postData.contents : "{}";
    var data = JSON.parse(raw);
    var ss = openSpreadsheet_(data);

    if (data.action === "createInvite") {
      return json_(createInvite_(ss, data));
    }

    if (data.action === "deleteInvite") {
      return json_(deleteInvite_(ss, data));
    }

    var sheet = getOrCreateSheet_(ss);
    ensureInviteCodeFirstColumn_(sheet);
    ensureHeaders_(sheet);

    var mapsUrl =
      data.mapsUrl ||
      "https://www.google.com/maps?q=" + data.latitude + "," + data.longitude;
    data.mapsUrl = mapsUrl;
    data.inviteCode = resolveInviteCode_(data);

    var rowNumber = writeLocationRow_(sheet, data);

    return json_({
      ok: true,
      written: true,
      sheet: sheet.getName(),
      row: rowNumber,
      inviteCode: data.inviteCode || "",
      spreadsheetName: ss.getName(),
      spreadsheetUrl: ss.getUrl(),
    });
  } catch (error) {
    return json_({ ok: false, error: String(error) });
  }
}

/**
 * Write one row in fixed HEADERS order (avoids wrong lat/lng from shifted columns).
 * A = Invite Code, B = Latitude, C = Longitude, …
 */
function writeLocationRow_(sheet, data) {
  ensureHeaders_(sheet);

  var inviteCode = resolveInviteCode_(data);
  var lat = Number(data.latitude);
  var lng = Number(data.longitude);
  var accuracy = Number(data.accuracy);
  var deviceDate = data.timestamp ? new Date(Number(data.timestamp)) : "";
  var mapsUrl =
    data.mapsUrl ||
    "https://www.google.com/maps?q=" + lat + "," + lng;

  var values = [
    inviteCode,
    lat,
    lng,
    accuracy,
    data.exactLocation || "",
    deviceDate || "",
    mapsUrl,
    data.type || "current",
    data.sessionId || "",
    data.deviceId || "",
    data.deviceName || "",
    data.model || "",
    data.os || "",
    data.browser || "",
    data.screen || "",
    data.timezone || "",
  ];

  var row = sheet.getLastRow() + 1;
  if (row < 2) row = 2;
  sheet.getRange(row, 1, row, values.length).setValues([values]);
  // Keep full GPS precision visible
  sheet.getRange(row, 2, row, 3).setNumberFormat("0.00000000");
  sheet.getRange(row, 6).setNumberFormat("M/d/yyyy H:mm:ss");

  return row;
}

/**
 * GET ?action=latest   → latest row per Device ID (for admin live map)
 * GET ?action=invites  → invite code list
 * GET ?action=upgrade  → rewrite header row
 * GET (default)        → health ping
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
      ensureInviteCodeFirstColumn_(upgradeSheet);
      removeObsoleteColumns_(upgradeSheet);
      ensureHeaders_(upgradeSheet);
      ensureInviteSheet_(ss);
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

    if (action === "invites") {
      return json_(listInvites_(ss));
    }

    return json_({
      ok: true,
      message: "PinTrail Sheets webhook is live. POST location JSON here.",
      spreadsheetName: ss.getName(),
      spreadsheetUrl: ss.getUrl(),
      actions: ["latest", "upgrade", "invites"],
    });
  } catch (error) {
    return json_({ ok: false, error: String(error) });
  }
}

/** Compare sheet timestamps reliably (Date, Lahore text, ISO, or serials). */
function toMillis_(value) {
  if (Object.prototype.toString.call(value) === "[object Date]") {
    var dateMs = value.getTime();
    return isNaN(dateMs) ? 0 : dateMs;
  }
  if (typeof value === "number" && isFinite(value)) {
    if (value > 0 && value < 1000000) {
      return Math.round((value - 25569) * 86400 * 1000);
    }
    return value;
  }

  var text = String(value || "").trim();
  // Lahore wall time written by formatLahore_: "yyyy-MM-dd HH:mm:ss"
  var lahore = text.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  if (lahore) {
    var lahoreMs = new Date(lahore[1] + "T" + lahore[2] + "+05:00").getTime();
    if (!isNaN(lahoreMs)) return lahoreMs;
  }

  var parsed = new Date(text).getTime();
  return isNaN(parsed) ? 0 : parsed;
}

function getLatestDevices_(ss) {
  var sheet = getOrCreateSheet_(ss);
  ensureInviteCodeFirstColumn_(sheet);
  ensureHeaders_(sheet);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return { ok: true, count: 0, devices: [] };
  }

  // Column map by header name (supports old + new layouts).
  var width = Math.max(sheet.getLastColumn(), HEADERS.length);
  var headers = sheet.getRange(1, 1, 1, width).getValues()[0];
  var col = {};
  for (var h = 0; h < headers.length; h++) {
    col[String(headers[h] || "").trim()] = h;
  }
  function cell(row, name, fallbackIndex) {
    var idx = col[name];
    if (idx == null) idx = fallbackIndex;
    return idx == null ? "" : row[idx];
  }

  var values = sheet.getRange(2, 1, lastRow, width).getValues();
  var byDevice = {};

  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    // Fixed layout: A Invite, B Lat, C Lng, D Acc, E Exact, F Device Timestamp…
    var lat = Number(cell(row, "Latitude", 1));
    var lng = Number(cell(row, "Longitude", 2));
    if (!isFinite(lat) || !isFinite(lng)) continue;

    var deviceId = String(cell(row, "Device ID", 9) || "").trim();
    var deviceName = String(cell(row, "Device Name", 10) || "").trim();
    var key = deviceId || deviceName || "unknown-" + i;
    var receivedMs = toMillis_(cell(row, "Device Timestamp", 5));
    var receivedAt = receivedMs ? new Date(receivedMs).toISOString() : "";
    var exactLocation = String(cell(row, "Exact Location", 4) || "");

    var inviteCode = String(cell(row, "Invite Code", 0) || "")
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, "")
      .slice(0, 32);
    if (!inviteCode) {
      var bracket = exactLocation.match(/^\[([a-zA-Z0-9_-]+)\]/);
      if (bracket) inviteCode = bracket[1];
    }
    if (!inviteCode) {
      var codeMatch = exactLocation.match(/Code:\s*([a-zA-Z0-9_-]+)/i);
      if (codeMatch) inviteCode = codeMatch[1];
    }

    var entry = {
      receivedAt: receivedAt,
      receivedMs: receivedMs,
      latitude: lat,
      longitude: lng,
      accuracy: Number(cell(row, "Accuracy (m)", 3)) || 0,
      exactLocation: exactLocation,
      mapsUrl: String(cell(row, "Google Maps", 6) || ""),
      type: String(cell(row, "Type", 7) || "current"),
      sessionId: String(cell(row, "Session ID", 8) || ""),
      deviceId: deviceId,
      deviceName: deviceName || key,
      model: String(cell(row, "Model", 11) || ""),
      os: String(cell(row, "OS", 12) || ""),
      browser: String(cell(row, "Browser", 13) || ""),
      screen: String(cell(row, "Screen", 14) || ""),
      language: "",
      timezone: String(cell(row, "Timezone", 15) || ""),
      inviteCode: inviteCode,
    };

    var prev = byDevice[key];
    if (!prev || entry.receivedMs >= prev.receivedMs) {
      byDevice[key] = entry;
    }
  }

  var devices = Object.keys(byDevice).map(function (k) {
    var device = byDevice[k];
    delete device.receivedMs;
    return device;
  });

  return { ok: true, count: devices.length, devices: devices };
}

function createInvite_(ss, data) {
  var sheet = ensureInviteSheet_(ss);
  var code = String(data.code || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 32);
  if (!code) {
    return { ok: false, error: "Invite code required." };
  }
  var label = String(data.label || "").trim().slice(0, 80);
  var createdAt = formatLahore_(data.createdAt ? new Date(data.createdAt) : new Date());
  var codeUpper = code.toUpperCase();

  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    var existing = sheet.getRange(2, 1, lastRow, 1).getValues();
    for (var i = 0; i < existing.length; i++) {
      if (String(existing[i][0] || "").trim().toUpperCase() === codeUpper) {
        if (label) sheet.getRange(i + 2, 2).setValue(label);
        return { ok: true, updated: true, code: code, label: label };
      }
    }
  }

  sheet.appendRow([code, label, createdAt]);
  return { ok: true, created: true, code: code, label: label };
}

function deleteInvite_(ss, data) {
  var sheet = ensureInviteSheet_(ss);
  var code = String(data.code || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 32);
  if (!code) {
    return { ok: false, error: "Invite code required." };
  }
  var codeUpper = code.toUpperCase();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return { ok: false, error: "Invite code not found." };
  }
  var existing = sheet.getRange(2, 1, lastRow, 1).getValues();
  for (var i = 0; i < existing.length; i++) {
    if (String(existing[i][0] || "").trim().toUpperCase() === codeUpper) {
      sheet.deleteRow(i + 2);
      return { ok: true, deleted: true, code: code };
    }
  }
  return { ok: false, error: "Invite code not found." };
}

function listInvites_(ss) {
  var sheet = ensureInviteSheet_(ss);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return { ok: true, count: 0, invites: [] };
  }
  var values = sheet.getRange(2, 1, lastRow, 3).getValues();
  var invites = [];
  for (var i = 0; i < values.length; i++) {
    var code = String(values[i][0] || "")
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, "")
      .slice(0, 32);
    if (!code) continue;
    var createdMs = toMillis_(values[i][2]);
    invites.push({
      code: code,
      label: String(values[i][1] || "").trim(),
      createdAt: createdMs ? new Date(createdMs).toISOString() : "",
    });
  }
  return { ok: true, count: invites.length, invites: invites };
}

function openSpreadsheet_(data) {
  var ss;
  if (data && data.spreadsheetId) {
    ss = SpreadsheetApp.openById(String(data.spreadsheetId));
  } else {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  }
  if (!ss) {
    throw new Error(
      "No active spreadsheet. Open Apps Script from the Google Sheet, then redeploy."
    );
  }
  try {
    ss.setSpreadsheetTimeZone(LAHORE_TZ);
  } catch (ignore) {
    /* ignore timezone set failures */
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

function ensureInviteSheet_(ss) {
  var sheet = ss.getSheetByName(INVITES_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(INVITES_SHEET);
  }
  sheet.getRange(1, 1, 1, INVITE_HEADERS.length).setValues([INVITE_HEADERS]);
  sheet.setFrozenRows(1);
  return sheet;
}

function ensureHeaders_(sheet) {
  removeObsoleteColumns_(sheet);
  var width = HEADERS.length;
  sheet.getRange(1, 1, 1, width).setValues([HEADERS]);
  sheet.setFrozenRows(1);
  var lastRow = Math.max(sheet.getLastRow(), 2);
  // B/C = Latitude / Longitude
  sheet.getRange(2, 2, lastRow, 3).setNumberFormat("0.00000000");
  // F = Device Timestamp
  sheet.getRange(2, 6, lastRow, 6).setNumberFormat("M/d/yyyy H:mm:ss");
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
