// Vercel Serverless Function — sends a WhatsApp template via the official
// WhatsApp Cloud API (Meta). The access token stays server-side (env var),
// never in the browser.
//
// Required Vercel env vars (Project → Settings → Environment Variables):
//   WHATSAPP_TOKEN            - Cloud API access token (secret)
//   WHATSAPP_PHONE_NUMBER_ID  - the sending phone number's ID
//   WHATSAPP_API_VERSION      - optional, defaults to v21.0
//
// POST body (JSON):
//   {
//     "to": "916282826684",              // 10-digit gets +91 prepended
//     "template": {
//       "name": "your_template_name",
//       "language": "en",                // language code, default "en"
//       "components": [ ... ]            // Cloud API template components (optional)
//     }
//   }

const COUNTRY_CODE = '91';

function toWaNumber(p) {
  var d = String(p || '').replace(/\D/g, '').replace(/^0+/, '');
  if (!d) return '';
  return d.length === 10 ? COUNTRY_CODE + d : d;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Use POST' });
  }

  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const version = process.env.WHATSAPP_API_VERSION || 'v21.0';
  if (!token || !phoneId) {
    return res.status(500).json({
      ok: false,
      error: 'WhatsApp not configured (set WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID).',
    });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const to = toWaNumber(body.to);
    const template = body.template || {};
    if (!to) return res.status(400).json({ ok: false, error: 'Missing/invalid "to".' });
    if (!template.name) return res.status(400).json({ ok: false, error: 'Missing "template.name".' });

    const payload = {
      messaging_product: 'whatsapp',
      to: to,
      type: 'template',
      template: {
        name: template.name,
        language: { code: template.language || 'en' },
      },
    };
    if (Array.isArray(template.components) && template.components.length) {
      payload.template.components = template.components;
    }

    const url = `https://graph.facebook.com/${version}/${phoneId}/messages`;
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const data = await r.json();

    if (!r.ok) {
      return res.status(r.status).json({
        ok: false,
        error: (data && data.error && data.error.message) || `HTTP ${r.status}`,
        data: data,
      });
    }
    const messageId = data && data.messages && data.messages[0] && data.messages[0].id;
    return res.status(200).json({ ok: true, to: to, messageId: messageId, data: data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String((err && err.message) || err) });
  }
}
