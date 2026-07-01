# Expo Lead Scanner

A mobile-first Vite + React web app for exhibitions. Scan a visitor's badge QR
(vCard/MECARD), auto-fill their contact details, tag the lead, and push it
straight into a **Google Sheet** — one row per lead.

**Sheet columns:** `date · name · phone · email · company · position · website ·
own_delivery_riders · petpooja · hot_or_not · need_to_call · notes · scanned_at`

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

## 5. Auto-send a WhatsApp flyer (optional)

When a lead is saved, the Apps Script can WhatsApp them your flyer via
[open-wa](https://github.com/open-wa/wa-automate-nodejs). The flyer lives at
`public/flyer.jpg` (served at `https://<your-app>/flyer.jpg` after deploy).

open-wa runs a real WhatsApp Web session in a headless browser, so it needs its
own **always-on host reachable over HTTPS** — it can't run on Vercel or Apps Script.

**Quickest path to a running + reachable server:**

1. On a machine that stays on during the expo (laptop or a small VM):
   ```bash
   npx @open-wa/wa-automate -k "your-secret-key" -p 8080
   ```
   A QR code prints in the terminal.
2. On the phone that will send the flyer: WhatsApp → **Linked Devices → Link a
   device** → scan the terminal QR. The session is saved (no rescans). The API is
   now at `http://localhost:8080` (Swagger at `/api-docs`).
3. Expose it over HTTPS so Google's servers can reach it:
   ```bash
   npx cloudflared tunnel --url http://localhost:8080
   ```
   Copy the printed `https://….trycloudflare.com` URL.
4. In [`google-apps-script.gs`](./google-apps-script.gs) set `WA_ENABLED = true`,
   `OPENWA_BASE_URL` (the cloudflared URL), `OPENWA_API_KEY`, `WA_IMAGE_URL`
   (`https://<your-app>/flyer.jpg`), and adjust `WA_CAPTION` / `WA_COUNTRY_CODE`.
   Then **redeploy** the Apps Script (Manage deployments → New version).

**Notes**
- The free `trycloudflare.com` URL changes on each restart — keep the tunnel +
  open-wa running for the whole expo, or use a named tunnel / VPS for a stable URL.
- Keep the sending phone online.
- open-wa is unofficial automation; WhatsApp can ban numbers used for bulk or
  unsolicited messaging. Only message people who shared their number at your booth,
  and keep the volume reasonable.

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
