/**
 * Expo Lead Scanner — Google Sheets backend
 * =========================================
 * Paste into the Sheet's Apps Script editor and deploy as a Web App.
 *
 * - New lead  -> appends a row AND sends the marketing template (expo_msg_v2)
 *                via the OREO DEMO WhatsApp number (official Cloud API).
 * - Editing a lead -> updates ONLY that lead's own row (matched by id); never
 *                touches any other row, and never re-sends WhatsApp.
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
  'sent_from', // which WhatsApp number sent it
  'id',        // internal lead id — used to update a lead instead of duplicating it
];

// ---------------------------------------------------------------------------
// WhatsApp marketing — official Cloud API (Meta). Sends the approved MARKETING
// template `expo_msg_v2` (flyer image + "I'm Interested" button) to each NEW
// lead, from the OREO DEMO partner number.
//   1. Paste the OREO DEMO access token into WA_ACCESS_TOKEN. Get it from
//      cravings-v2 Hasura: table whatsapp_business_integrations, partner
//      "OREO DEMO". Keep it secret — do NOT commit the real token.
//   2. Set WA_ENABLED = true.
// Requires the "External requests" permission in appsscript.json (see README).
// ---------------------------------------------------------------------------
var WA_ENABLED = false; // master switch — set true once WA_ACCESS_TOKEN is filled
var WA_API_VERSION = 'v22.0';
var WA_PHONE_NUMBER_ID = '1203546912837921'; // OREO DEMO Cloud API sender (coexistence)
var WA_ACCESS_TOKEN = 'YOUR_OREO_DEMO_ACCESS_TOKEN'; // OREO DEMO token (secret — from cravings-v2 Hasura)
var WA_TEMPLATE_NAME = 'expo_msg_v2'; // approved MARKETING template on the OREO DEMO WABA
var WA_TEMPLATE_LANG = 'en';
var WA_IMAGE_URL = 'https://raw.githubusercontent.com/ab-h-i-n/exibition-data-collector/main/public/flyer.jpg';
var WA_SENDER_LABEL = 'OREO DEMO'; // recorded in the sent_from column
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
      var existingRow = r.id ? findRowById_(sheet, r.id) : -1;
      var waStatus = '';
      var sentFrom = '';
      if (existingRow > 0) {
        // Editing / re-syncing a lead: update ONLY its own row.
        var prev = String(sheet.getRange(existingRow, colIndex_('whatsapp_sent')).getValue() || '');
        sentFrom = sheet.getRange(existingRow, colIndex_('sent_from')).getValue();
        if (WA_ENABLED && prev.indexOf('Sent') !== 0) {
          // Previous attempt wasn't a success — retry now (e.g. after fixing the number).
          var retry = sendFlyerWhatsApp_(r);
          waStatus = retry.status;
          sentFrom = retry.from;
        } else {
          waStatus = prev; // already sent (or WA off) — never resend
        }
        sheet.getRange(existingRow, 1, 1, HEADERS.length).setValues([rowFor_(r, waStatus, sentFrom)]);
      } else {
        // New lead: send the flyer (if enabled), then append a new row.
        if (WA_ENABLED) {
          var result = sendFlyerWhatsApp_(r);
          waStatus = result.status;
          sentFrom = result.from;
        }
        sheet.appendRow(rowFor_(r, waStatus, sentFrom));
      }
      whatsapp.push(waStatus);
    });
    return json_({ ok: true, count: records.length, whatsapp: whatsapp });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

// Open the deployment URL in a browser to confirm it's live + see the target.
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
    // Only write the NEW header cells — never overwrite existing headers/data.
    var from = sheet.getLastColumn() + 1;
    var extra = HEADERS.slice(from - 1);
    sheet.getRange(1, from, 1, extra.length).setValues([extra]);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  }
  return sheet;
}

function colIndex_(name) {
  return HEADERS.indexOf(name) + 1;
}

// Row number (>= 2) whose 'id' column matches, else -1. Used to update a lead
// in place instead of appending a duplicate.
function findRowById_(sheet, id) {
  var last = sheet.getLastRow();
  var idCol = colIndex_('id');
  if (last < 2 || !id || idCol < 1) return -1;
  var ids = sheet.getRange(2, idCol, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
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

// Sends the marketing template (expo_msg_v2) via the official WhatsApp Cloud
// API. Only the header image is passed at send time — the body/footer are static
// and the "I'm Interested" quick-reply button needs no parameters.
// Returns { status, from }. Never throws.
function sendFlyerWhatsApp_(r) {
  try {
    var to = toWaNumber_(r && r.phone);
    if (!to) return { status: 'No number', from: '' };
    var payload = {
      messaging_product: 'whatsapp',
      to: to,
      type: 'template',
      template: {
        name: WA_TEMPLATE_NAME,
        language: { code: WA_TEMPLATE_LANG },
        components: [
          {
            type: 'header',
            parameters: [{ type: 'image', image: { link: WA_IMAGE_URL } }],
          },
        ],
      },
    };
    var res = UrlFetchApp.fetch(
      'https://graph.facebook.com/' + WA_API_VERSION + '/' + WA_PHONE_NUMBER_ID + '/messages',
      {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + WA_ACCESS_TOKEN },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
      }
    );
    var code = res.getResponseCode();
    if (code >= 200 && code < 300) return { status: 'Sent', from: WA_SENDER_LABEL };
    var msg = '';
    try { msg = JSON.parse(res.getContentText()).error.message; } catch (e) {}
    return { status: 'Failed (' + code + (msg ? ': ' + msg : '') + ')', from: WA_SENDER_LABEL };
  } catch (err) {
    return { status: 'Failed: ' + (err && err.message ? err.message : err), from: '' };
  }
}

// Run once from the editor (select testWhatsApp -> Run) to grant the external-
// requests permission and send yourself a test. Check the Execution log.
function testWhatsApp() {
  var r = sendFlyerWhatsApp_({ phone: '917012944024' });
  Logger.log('WhatsApp test: ' + r.status + ' from ' + r.from);
  return r;
}

// Local 10-digit -> "<countrycode><number>" for the Cloud API "to" field.
// Returns '' for anything that isn't a plausible E.164 mobile (11-15 digits),
// so bad badge numbers are marked "No number" instead of erroring with a 400.
function toWaNumber_(phone) {
  if (!phone) return '';
  var d = String(phone).replace(/[^\d]/g, '').replace(/^0+/, '');
  if (d.length === 10) d = WA_COUNTRY_CODE + d; // local mobile -> add country code
  if (d.length < 11 || d.length > 15) return '';
  return d;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
