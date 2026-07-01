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

// ---------------------------------------------------------------------------
// WhatsApp auto-send (open-wa) — OPTIONAL
// Sends the flyer image to each new lead's WhatsApp the moment they're saved.
// Leave WA_ENABLED = false until your open-wa server is running and reachable
// over HTTPS (see README → "Auto-send a WhatsApp flyer").
// ---------------------------------------------------------------------------
var WA_ENABLED = false; // master switch — set true once the values below are filled
var OPENWA_BASE_URL = 'https://openwa.menuthere.com'; // OpenWA gateway base (no trailing slash)
var OPENWA_SESSION_ID = 'YOUR_SESSION_ID'; // connected WhatsApp session id (GET /api/sessions)
var OPENWA_API_KEY = 'YOUR_OPENWA_API_KEY'; // gateway X-API-Key
// Works out-of-the-box from the public repo; or swap to https://<your-app>/flyer.jpg
var WA_IMAGE_URL = 'https://raw.githubusercontent.com/ab-h-i-n/exibition-data-collector/main/public/flyer.jpg';
var WA_CAPTION = 'Thanks for visiting us at the expo! 🚀 Here is what Menuthere does — reply to chat with us.';
var WA_COUNTRY_CODE = '91'; // prepended to local 10-digit numbers

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
    if (WA_ENABLED) {
      records.forEach(function (r) {
        sendFlyerWhatsApp_(r);
      });
    }
    return json_({ ok: true, count: records.length });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

// Open the deployment URL in a browser to confirm it's live AND see exactly
// which spreadsheet/tab is receiving data and how many lead rows exist.
function doGet() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = getSheet_();
    return json_({
      ok: true,
      message: 'Expo Lead Scanner endpoint is live.',
      spreadsheet: ss.getName(),
      spreadsheetUrl: ss.getUrl(),
      tab: SHEET_NAME,
      leadRows: Math.max(0, sheet.getLastRow() - 1),
    });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
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

// Sends the flyer image to one lead via the open-wa EASY API. Never throws —
// a WhatsApp failure must not block saving the lead to the sheet.
function sendFlyerWhatsApp_(r) {
  try {
    var chatId = toChatId_(r && r.phone);
    if (!chatId) return;
    var endpoint =
      OPENWA_BASE_URL + '/api/sessions/' + OPENWA_SESSION_ID + '/messages/send-image';
    var payload = {
      chatId: chatId,
      url: WA_IMAGE_URL,
      filename: 'menuthere-flyer.jpg',
      caption: WA_CAPTION,
    };
    UrlFetchApp.fetch(endpoint, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'X-API-Key': OPENWA_API_KEY },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
  } catch (err) {
    // swallow — the lead is already safely in the sheet
  }
}

// Turns a scanned phone number into a WhatsApp chatId (e.g. "916282826684@c.us").
function toChatId_(phone) {
  if (!phone) return '';
  var digits = String(phone).replace(/[^\d]/g, '').replace(/^0+/, '');
  if (!digits) return '';
  if (digits.length === 10) digits = WA_COUNTRY_CODE + digits; // local → add country code
  return digits + '@c.us';
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
