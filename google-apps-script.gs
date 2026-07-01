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
  'whatsapp_sent',
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
var WA_CAPTION = 'Hello, this is the team from Menuthere. Thank you for enquiring about our product today.';
// Two follow-up messages, sent as plain text right after the flyer, in order.
var WA_FOLLOWUP_1 = 'Please find a short demo video of our platform here: https://youtube.com/shorts/6PR2BqLIxIA?si=OHtPPRDlykojCZGs - kindly note the video is currently in Malayalam. If language is a concern, please let us know and we will be glad to arrange it in your preferred language.';
var WA_FOLLOWUP_2 = 'We would also be glad to connect over a quick call to walk you through how Menuthere can help your business. Could you please share a convenient time for us to reach you?';
var WA_COUNTRY_CODE = '91'; // prepended to local 10-digit numbers

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000); // avoid two devices writing at once
    var body = JSON.parse(e.postData.contents);
    var records = Array.isArray(body.records) ? body.records : [body];
    var sheet = getSheet_();
    var whatsapp = [];
    records.forEach(function (r) {
      // Send first (if enabled) so the row records whether it actually went out.
      var waStatus = WA_ENABLED ? sendFlyerWhatsApp_(r) : '';
      sheet.appendRow(rowFor_(r, waStatus));
      whatsapp.push(waStatus);
    });
    return json_({ ok: true, count: records.length, whatsapp: whatsapp });
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
  } else if (sheet.getLastColumn() < HEADERS.length) {
    // A column was added to HEADERS (e.g. whatsapp_sent) — extend the header row
    // of an existing sheet so the new values line up under a proper header.
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  }
  return sheet;
}

function rowFor_(r, waStatus) {
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
    waStatus || '',
  ];
}

// Sends the flyer to one lead via the OpenWA gateway and returns a status
// string for the sheet: 'Sent' | 'Failed (<code>)' | 'Failed' | 'No number'.
// Never throws — a WhatsApp failure must not block saving the lead.
function sendFlyerWhatsApp_(r) {
  try {
    var chatId = toChatId_(r && r.phone);
    if (!chatId) return 'No number';
    var base = OPENWA_BASE_URL + '/api/sessions/' + OPENWA_SESSION_ID + '/messages/';
    var opts = function (payload) {
      return {
        method: 'post',
        contentType: 'application/json',
        headers: { 'X-API-Key': OPENWA_API_KEY },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
      };
    };
    // 1) flyer image with the intro caption
    var res = UrlFetchApp.fetch(
      base + 'send-image',
      opts({ chatId: chatId, url: WA_IMAGE_URL, filename: 'menuthere-flyer.jpg', caption: WA_CAPTION })
    );
    var code = res.getResponseCode();
    var imageOk = code >= 200 && code < 300;
    // 2) + 3) two follow-up texts, in order — best effort (won't flip the status)
    try {
      Utilities.sleep(1200); // let the image land first
      UrlFetchApp.fetch(base + 'send-text', opts({ chatId: chatId, text: WA_FOLLOWUP_1 }));
      Utilities.sleep(600);
      UrlFetchApp.fetch(base + 'send-text', opts({ chatId: chatId, text: WA_FOLLOWUP_2 }));
    } catch (e2) {
      /* ignore follow-up failure */
    }
    return imageOk ? 'Sent' : 'Failed (' + code + ')';
  } catch (err) {
    return 'Failed: ' + (err && err.message ? err.message : err);
  }
}

// Run this ONCE from the editor (pick "testWhatsApp" in the toolbar → Run) to
// grant the "Connect to an external service" permission and send yourself a test
// flyer. Watch the Execution log — it prints 'Sent' or 'Failed: <reason>'.
function testWhatsApp() {
  var status = sendFlyerWhatsApp_({ phone: '917012944024' });
  Logger.log('WhatsApp test result: ' + status);
  return status;
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
