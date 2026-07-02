/**
 * Expo Lead Scanner — Google Sheets backend
 * =========================================
 * Paste this into a Google Sheet's Apps Script editor and deploy as a Web App.
 * See README.md → "Connect your Google Sheet" for the setup.
 *
 * APPEND-ONLY: every save adds a new row; existing rows are never modified.
 * Optionally sends each NEW lead the flyer + follow-up on WhatsApp via OpenWA,
 * rotating across multiple sending numbers, and records which one sent.
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
  'sent_from', // which WhatsApp number/session sent it
  'id', // internal lead id — used to avoid messaging the same lead twice
];

// ---------------------------------------------------------------------------
// WhatsApp auto-send via the OpenWA gateway.
// Sends rotate across OPENWA_SESSIONS (spreads load across numbers).
// Needs the "External requests" permission (declared in appsscript.json).
// ---------------------------------------------------------------------------
var WA_ENABLED = false; // master switch — set true once configured
var OPENWA_BASE_URL = 'https://openwa.menuthere.com';
var OPENWA_API_KEY = 'YOUR_OPENWA_API_KEY';
var OPENWA_SESSIONS = [
  { id: 'YOUR_SESSION_ID', name: 'session-1' },
  // { id: 'ANOTHER_SESSION_ID', name: 'session-2' }, // add numbers to rotate
];
var WA_IMAGE_URL = 'https://raw.githubusercontent.com/ab-h-i-n/exibition-data-collector/main/public/flyer.jpg';
var WA_CAPTION = 'Hello! 👋 This is the Menuthere team.\n\nThank you for your interest in Menuthere today. To receive *priority support* and access to our *free trial*, please fill out this short form:\n\nhttps://forms.gle/igwJHfe96nnKBbef6\n\nWe look forward to helping you get started!';
var WA_FOLLOWUP_2 = 'Are you available for a call today or tomorrow?';
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
      var waStatus = '';
      var sentFrom = '';
      if (WA_ENABLED) {
        if (alreadySentWhatsApp_(sheet, r.id)) {
          // Lead already messaged — do NOT send again on edits / re-syncs.
          waStatus = 'Skipped (already sent)';
        } else {
          var result = sendFlyerWhatsApp_(r);
          waStatus = result.status;
          sentFrom = result.from;
        }
      }
      // Always append a new row — existing rows are never modified.
      sheet.appendRow(rowFor_(r, waStatus, sentFrom));
      whatsapp.push(waStatus);
    });
    return json_({ ok: true, count: records.length, whatsapp: whatsapp });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

// Open the deployment URL in a browser to confirm it's live AND see which
// spreadsheet/tab is receiving data and how many lead rows exist.
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
    // New columns were added to HEADERS — write ONLY the new header cells so
    // existing headers and data are never overwritten.
    var from = sheet.getLastColumn() + 1;
    var extra = HEADERS.slice(from - 1);
    sheet.getRange(1, from, 1, extra.length).setValues([extra]);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  }
  return sheet;
}

// 1-based column index for a header name (e.g. colIndex_('id')).
function colIndex_(name) {
  return HEADERS.indexOf(name) + 1;
}

// True if a row with this lead id already shows a successful WhatsApp send, so
// edits / re-syncs don't message the same lead again. Read-only (no writes).
function alreadySentWhatsApp_(sheet, id) {
  var last = sheet.getLastRow();
  if (last < 2 || !id) return false;
  var idCol = colIndex_('id');
  var waCol = colIndex_('whatsapp_sent');
  var rows = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (
      String(rows[i][idCol - 1]) === String(id) &&
      String(rows[i][waCol - 1] || '').indexOf('Sent') === 0
    ) {
      return true;
    }
  }
  return false;
}

function rowFor_(r, waStatus, sentFrom) {
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
    sentFrom || '',
    r.id || '',
  ];
}

// Rotates the sending session across OPENWA_SESSIONS (position persisted in
// Script Properties), so consecutive leads use different numbers.
function nextSession_() {
  var props = PropertiesService.getScriptProperties();
  var n = parseInt(props.getProperty('WA_ROTATE') || '0', 10);
  if (isNaN(n) || n < 0) n = 0;
  var session = OPENWA_SESSIONS[n % OPENWA_SESSIONS.length];
  props.setProperty('WA_ROTATE', String((n + 1) % 1000000));
  return session;
}

// Sends the flyer (with caption) then the follow-up text via the rotated
// session. Returns { status, from }. Never throws.
function sendFlyerWhatsApp_(r) {
  try {
    var chatId = toChatId_(r && r.phone);
    if (!chatId) return { status: 'No number', from: '' };
    var session = nextSession_();
    var base = OPENWA_BASE_URL + '/api/sessions/' + session.id + '/messages/';
    var opts = function (payload) {
      return {
        method: 'post',
        contentType: 'application/json',
        headers: { 'X-API-Key': OPENWA_API_KEY },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
      };
    };
    var res = UrlFetchApp.fetch(
      base + 'send-image',
      opts({ chatId: chatId, url: WA_IMAGE_URL, filename: 'menuthere-flyer.jpg', caption: WA_CAPTION })
    );
    var code = res.getResponseCode();
    var imageOk = code >= 200 && code < 300;
    try {
      Utilities.sleep(1200); // let the image land first
      UrlFetchApp.fetch(base + 'send-text', opts({ chatId: chatId, text: WA_FOLLOWUP_2 }));
    } catch (e2) {
      /* follow-up is best-effort */
    }
    return { status: imageOk ? 'Sent' : 'Failed (' + code + ')', from: session.name };
  } catch (err) {
    return { status: 'Failed: ' + (err && err.message ? err.message : err), from: '' };
  }
}

// Run once from the editor (select testWhatsApp -> Run) to test / grant perms.
function testWhatsApp() {
  var result = sendFlyerWhatsApp_({ phone: '917012944024' });
  Logger.log('WhatsApp test: ' + result.status + ' from ' + result.from);
  return result;
}

// Turns a scanned phone number into a WhatsApp chatId (e.g. "916282826684@c.us").
function toChatId_(phone) {
  if (!phone) return '';
  var digits = String(phone).replace(/[^\d]/g, '').replace(/^0+/, '');
  if (!digits) return '';
  if (digits.length === 10) digits = WA_COUNTRY_CODE + digits; // local -> add country code
  return digits + '@c.us';
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
