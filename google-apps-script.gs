/**
 * Expo Lead Scanner — Google Sheets backend
 * =========================================
 * Paste this into a Google Sheet's Apps Script editor and deploy as a Web App.
 * See README.md → "Connect your Google Sheet" for the 6-step setup.
 *
 * It appends one row per scanned lead into a sheet/tab named "Leads",
 * creating the tab + header row automatically on first use.
 */

var SHEET_NAME = 'Leads';
var HEADERS = [
  'date',
  'name',
  'phone',
  'email',
  'company',
  'position',
  'website',
  'own_delivery_riders',
  'petpooja',
  'hot_or_not',
  'need_to_call',
  'notes',
  'scanned_at',
];

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000); // avoid two devices writing at once
    var body = JSON.parse(e.postData.contents);
    var records = Array.isArray(body.records) ? body.records : [body];
    var sheet = getSheet_();
    records.forEach(function (r) {
      sheet.appendRow(rowFor_(r));
    });
    return json_({ ok: true, count: records.length });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

// Lets you open the deployment URL in a browser to confirm it's live.
function doGet() {
  return json_({ ok: true, message: 'Expo Lead Scanner endpoint is live.' });
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function rowFor_(r) {
  r = r || {};
  return [
    r.date || '',
    r.name || '',
    r.phone ? "'" + r.phone : '', // leading quote keeps long numbers as text
    r.email || '',
    r.company || '',
    r.position || '',
    r.website || '',
    r.ownDelivery ? 'Yes' : 'No',
    r.petpooja ? 'Yes' : 'No',
    r.hotOrNot || '',
    r.needToCall ? 'Yes' : 'No',
    r.notes || '',
    r.scannedAt || new Date().toISOString(),
  ];
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
