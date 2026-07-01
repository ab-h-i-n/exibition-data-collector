// Local-first storage for leads + the Google Sheet endpoint.
// Every scan is stored in localStorage immediately, so nothing is lost if the
// network drops on the expo floor. Sync status is tracked per record.

const KEY = 'edc_records';
const ENDPOINT_KEY = 'edc_endpoint';

export const COLUMNS = [
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

export function loadRecords() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}

export function saveRecords(list) {
  localStorage.setItem(KEY, JSON.stringify(list));
}

export function upsertRecord(rec) {
  const list = loadRecords();
  const i = list.findIndex((r) => r.id === rec.id);
  if (i === -1) list.unshift(rec);
  else list[i] = rec;
  saveRecords(list);
  return list;
}

export function updateRecord(id, patch) {
  const list = loadRecords().map((r) => (r.id === id ? { ...r, ...patch } : r));
  saveRecords(list);
  return list;
}

export function deleteRecord(id) {
  const list = loadRecords().filter((r) => r.id !== id);
  saveRecords(list);
  return list;
}

export function getEndpoint() {
  return localStorage.getItem(ENDPOINT_KEY) || '';
}

export function setEndpoint(url) {
  localStorage.setItem(ENDPOINT_KEY, (url || '').trim());
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function rowFor(r) {
  return [
    r.date,
    r.name,
    r.phone,
    r.email,
    r.company,
    r.position,
    r.website,
    r.ownDelivery ? 'Yes' : 'No',
    r.petpooja ? 'Yes' : 'No',
    r.hotOrNot || '',
    r.needToCall ? 'Yes' : 'No',
    r.notes || '',
    r.scannedAt || '',
  ];
}

export function toCSV(list) {
  const lines = [COLUMNS.map(csvCell).join(',')];
  for (const r of list) lines.push(rowFor(r).map(csvCell).join(','));
  return lines.join('\n');
}

export function downloadCSV(list, filename) {
  const blob = new Blob([toCSV(list)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `expo-leads-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
