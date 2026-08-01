/**
 * PinTrail → Google Sheets receiver
 *
 * 1) From YOUR target spreadsheet: Extensions → Apps Script
 * 2) Paste this entire file → Save
 * 3) Run TEST_WRITE_NOW (select it → Run → Allow permissions)
 *    A row should appear immediately in that sheet.
 * 4) Deploy → Manage deployments → pencil → New version
 *    Execute as: Me | Who has access: Anyone → Deploy
 * 5) Use the /exec URL in .env (not /dev)
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
];

/** Run this once from the Apps Script editor to verify the bound spreadsheet. */
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
    "TEST_WRITE_NOW — if you see this, the script is linked to THIS spreadsheet",
    new Date().toISOString(),
    "https://www.google.com/maps?q=11.11,22.22",
    "current",
    "test-session",
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

function doGet() {
  var info = { ok: true, message: "PinTrail Sheets webhook is live. POST location JSON here." };
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss) {
      info.spreadsheetName = ss.getName();
      info.spreadsheetUrl = ss.getUrl();
    }
  } catch (e) {}
  return json_(info);
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
  var firstRow = sheet.getRange(1, 1, 1, width).getValues()[0];
  var empty = firstRow.every(function (cell) {
    return cell === "" || cell === null;
  });
  if (empty) {
    sheet.getRange(1, 1, 1, width).setValues([HEADERS]);
    sheet.setFrozenRows(1);
    return;
  }

  // Upgrade older sheets that only have the original 7 columns.
  if (String(firstRow[7] || "") !== "Type") {
    sheet.getRange(1, 8, 1, 2).setValues([["Type", "Session ID"]]);
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
