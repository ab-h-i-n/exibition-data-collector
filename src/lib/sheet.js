// Pushes a lead to the Google Apps Script Web App endpoint.
//
// We POST with Content-Type: text/plain so the browser treats it as a "simple
// request" and skips the CORS preflight (which Apps Script cannot answer). The
// Apps Script reads the raw body via e.postData.contents and appends a row.

function payloadFor(r) {
  return {
    date: r.date || '',
    name: r.name || '',
    phone: r.phone || '',
    email: r.email || '',
    company: r.company || '',
    position: r.position || '',
    website: r.website || '',
    ownDelivery: !!r.ownDelivery,
    petpooja: !!r.petpooja,
    hotOrNot: r.hotOrNot || '',
    needToCall: !!r.needToCall,
    notes: r.notes || '',
    scannedAt: r.scannedAt || '',
    id: r.id,
  };
}

export async function pushToSheet(endpoint, record) {
  if (!endpoint) return { ok: false, error: 'No Google Sheet connected. Open Settings.' };

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payloadFor(record)),
      redirect: 'follow',
    });

    // Try to read the JSON result. If the body is unreadable but the request
    // resolved with a 2xx, treat it as success.
    let ok = res.ok;
    try {
      const data = await res.json();
      if (data && typeof data.ok === 'boolean') ok = data.ok;
    } catch {
      /* non-JSON / opaque response — fall back to res.ok */
    }

    return ok
      ? { ok: true }
      : { ok: false, error: `Sheet rejected the row (HTTP ${res.status}).` };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}
