# Expo Lead Scanner

A mobile-first Vite + React web app for exhibitions. Scan a visitor's badge QR
(vCard/MECARD), auto-fill their contact details, tag the lead, and push it
straight into a **Google Sheet** — one row per lead.

**Sheet columns:** `date · name · phone · email · company · position · website ·
own_delivery_riders · petpooja · hot_or_not · need_to_call · notes · scanned_at ·
whatsapp_sent`

Every scan is also saved on the device (localStorage) and can be exported to CSV,
so no lead is lost if the venue Wi-Fi drops.

---

## 1. Run locally

```bash
npm install
npm run dev
```

Open the printed `http://localhost:5173` URL. The camera works on `localhost`.

> **Phone testing:** browsers only allow the camera on **HTTPS** (or localhost).
> To scan on your phone, deploy it (below) or use a tunnel like
> `npx cloudflared tunnel --url http://localhost:5173`.

## 2. Deploy (get an HTTPS link for your phone)

```bash
npm run build      # outputs to dist/
```

Drop the repo on **Vercel** or **Netlify** (framework auto-detected as Vite), or
push `dist/` to any static host. You'll get an HTTPS URL you can open on your
phone at the expo.

---

## 3. Connect your Google Sheet

The app writes to your Sheet through a tiny Google Apps Script Web App — no
server, no API keys.

1. Create a Google Sheet (any blank one).
2. In the Sheet: **Extensions → Apps Script**.
3. Delete the sample code, then paste **all** of [`google-apps-script.gs`](./google-apps-script.gs).
4. Click **Deploy → New deployment**.
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Click **Deploy**, authorize when prompted, and copy the **Web app URL**
   (ends in `/exec`).
6. Open the app → tap the **⚙ gear** → paste the URL → **Save**.

That's it. The script auto-creates a **Leads** tab with the header row on the
first scan. Open the `/exec` URL in a browser anytime — it should reply
`{"ok":true,...}`.

### Auto-connect every device (recommended — set it once)

So every phone auto-saves to the Sheet without pasting the URL in Settings, bake
the `/exec` URL in as a build-time env var:

- **Vercel:** Project → **Settings → Environment Variables** → add
  `VITE_SHEET_ENDPOINT` = your `/exec` URL (all environments) → **Save**, then
  **Redeploy**.
- **Local dev:** `cp .env.example .env.local` and set the same value.

> ⚠️ Vite bakes env vars in at **build time**, so you must **redeploy** after
> adding or changing it. Because this is a static site, the URL ends up visible
> in the shipped JS — that's fine here (the endpoint is already public), but
> never put real secrets in a `VITE_*` var.

A URL pasted in the app's Settings still overrides this on that device.

---

## 4. Using it at the expo

- **Scan Badge** → point at the QR → the form auto-fills → add tags → **Save & Sync**.
- **Add Manually** for badges without a QR.
- Each lead shows a green dot (synced) or amber dot (pending).
- **Sync (n)** re-pushes any pending leads once you're back online.
- **Export CSV** downloads everything as a backup.

### Lead tags
- **Hot / Warm / Cold** — lead temperature.
- **Need to call** — follow-up flag.
- **Own delivery riders** — does the lead run their own delivery fleet?
- **Petpooja** — does the lead use Petpooja POS?

---

## 5. Auto-send a WhatsApp flyer (official Cloud API)

When a **new** lead is saved, the Apps Script sends them the flyer via the
official **WhatsApp Cloud API** using an approved template. The flyer lives at
`public/flyer.jpg` (served at the raw GitHub URL and `https://<your-app>/flyer.jpg`).

You need an approved template on the **same WhatsApp Business Account (WABA)** as
your sending number — this repo uses **`expo_flyer_msg`** (image header + body +
a "Fill Form" URL button). Then in [`google-apps-script.gs`](./google-apps-script.gs):

- `WA_ENABLED = true`
- `WA_PHONE_NUMBER_ID` = your Cloud API sender's Phone Number ID
- `WA_ACCESS_TOKEN` = your Cloud API access token *(stays only in the private script)*
- `WA_TEMPLATE_NAME` / `WA_TEMPLATE_LANG` = the template + its language (e.g. `en`)
- `WA_IMAGE_URL` = the flyer URL

Run the **`testWhatsApp`** function once from the editor to grant the
"External requests" permission (declared in `appsscript.json`), then **redeploy**
(Manage deployments → New version).

**Notes**
- The sending number and the template must be on the **same WABA**, or Meta
  returns `132001 "template does not exist"`.
- Editing a lead **never re-sends** WhatsApp — only genuinely new leads trigger a send.

## Project structure

```
index.html
google-apps-script.gs      # paste into Apps Script (the Sheets backend)
src/
  main.jsx
  App.jsx                  # UI: scan, form, leads list, settings, sync
  Scanner.jsx              # camera + QR decode (html5-qrcode, rear camera)
  styles.css
  lib/
    vcard.js               # parses vCard / MECARD / url / phone / email
    sheet.js               # POSTs a lead to the Apps Script endpoint
    storage.js             # localStorage queue + CSV export
```
