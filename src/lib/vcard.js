// Parses QR contact payloads into a normalized contact object.
// Supports vCard (2.1/3.0/4.0), MECARD, plain URL / email / phone, and raw text.

const EMPTY = () => ({
  name: '',
  phone: '',
  email: '',
  company: '',
  position: '',
  website: '',
  raw: '',
});

export function parseContact(raw) {
  const text = (raw || '').trim();
  const base = EMPTY();
  base.raw = text;
  if (!text) return base;

  if (/^BEGIN:VCARD/i.test(text)) return parseVCard(text, base);
  if (/^MECARD:/i.test(text)) return parseMeCard(text, base);
  if (/^https?:\/\//i.test(text)) return { ...base, website: text };
  if (/^mailto:/i.test(text)) return { ...base, email: text.replace(/^mailto:/i, '').trim() };
  if (/^tel:/i.test(text)) return { ...base, phone: cleanPhone(text.replace(/^tel:/i, '')) };
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text)) return { ...base, email: text };
  if (/^\+?[\d\s\-()]{6,}$/.test(text)) return { ...base, phone: cleanPhone(text) };

  // Unknown format — keep the raw so the user can copy/paste manually.
  return { ...base, name: text.length <= 60 ? text : '' };
}

// vCard lines can be "folded": a continuation line starts with a space/tab.
function unfold(text) {
  const lines = text.split(/\r\n|\r|\n/);
  const out = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line) && out.length) {
      out[out.length - 1] += line.replace(/^[ \t]/, '');
    } else {
      out.push(line);
    }
  }
  return out;
}

function parseVCard(text, base) {
  const res = { ...base };
  let fn = '';
  let n = '';

  for (const line of unfold(text)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const left = line.slice(0, idx);
    let value = decodeValue(left, line.slice(idx + 1)).trim();
    if (!value) continue;
    const prop = left.split(';')[0].toUpperCase();

    switch (prop) {
      case 'FN':
        fn = value;
        break;
      case 'N':
        n = value;
        break;
      case 'TEL':
        if (!res.phone) res.phone = cleanPhone(value);
        break;
      case 'EMAIL':
        if (!res.email) res.email = value.replace(/\s+/g, '');
        break;
      case 'ORG':
        if (!res.company) res.company = value.replace(/;+\s*$/, '').replace(/;/g, ' - ').trim();
        break;
      case 'TITLE':
      case 'ROLE':
        if (!res.position) res.position = value;
        break;
      case 'URL':
        if (!res.website) res.website = value;
        break;
      default:
        break;
    }
  }

  res.name = fn || nameFromN(n);
  return res;
}

// Handle quoted-printable and escaped values in vCard params.
function decodeValue(left, value) {
  if (/ENCODING=QUOTED-PRINTABLE/i.test(left)) {
    try {
      return value
        .replace(/=\r?\n/g, '')
        .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    } catch {
      return value;
    }
  }
  return value.replace(/\\n/gi, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';');
}

function nameFromN(n) {
  if (!n) return '';
  const p = n.split(';').map((s) => s.trim());
  const family = p[0] || '';
  const given = p[1] || '';
  if (given && family) return `${given} ${family}`;
  return [given, family].filter(Boolean).join(' ') || n.replace(/;+/g, ' ').trim();
}

function parseMeCard(text, base) {
  const res = { ...base };
  const body = text.replace(/^MECARD:/i, '');
  for (const seg of body.split(';')) {
    const i = seg.indexOf(':');
    if (i === -1) continue;
    const k = seg.slice(0, i).toUpperCase();
    const v = seg.slice(i + 1).trim();
    if (!v) continue;
    if (k === 'N') res.name = v.split(',').map((s) => s.trim()).filter(Boolean).reverse().join(' ');
    else if (k === 'TEL') res.phone = cleanPhone(v);
    else if (k === 'EMAIL') res.email = v;
    else if (k === 'ORG') res.company = v;
    else if (k === 'URL') res.website = v;
    else if (k === 'TITLE') res.position = v;
  }
  return res;
}

function cleanPhone(v) {
  const t = (v || '').trim();
  const plus = t.startsWith('+');
  const digits = t.replace(/[^\d]/g, '');
  return plus ? `+${digits}` : digits;
}
