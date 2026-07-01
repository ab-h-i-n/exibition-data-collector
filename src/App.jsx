import { useEffect, useMemo, useState } from 'react';
import Scanner from './Scanner.jsx';
import { parseContact } from './lib/vcard.js';
import { pushToSheet } from './lib/sheet.js';
import {
  loadRecords,
  upsertRecord,
  updateRecord,
  deleteRecord,
  getEndpoint,
  setEndpoint,
  downloadCSV,
  ENV_ENDPOINT,
} from './lib/storage.js';

const uid = () =>
  (crypto.randomUUID && crypto.randomUUID()) || `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const todayStr = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const blankForm = () => ({
  id: uid(),
  date: todayStr(),
  name: '',
  phone: '',
  email: '',
  company: '',
  position: '',
  website: '',
  ownDelivery: false,
  petpooja: false,
  hotOrNot: '',
  needToCall: false,
  notes: '',
  scannedAt: new Date().toISOString(),
  synced: false,
});

export default function App() {
  const [records, setRecords] = useState(() => loadRecords());
  const [endpoint, setEndpointState] = useState(() => getEndpoint());
  const [scanning, setScanning] = useState(false);
  const [form, setForm] = useState(null); // active lead being edited/created
  const [showSettings, setShowSettings] = useState(false);
  const [toast, setToast] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const unsynced = useMemo(() => records.filter((r) => !r.synced), [records]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  function notify(message, type = 'info') {
    setToast({ message, type });
  }

  function handleScan(text) {
    setScanning(false);
    const parsed = parseContact(text);
    if (navigator.vibrate) navigator.vibrate(60);
    setForm({ ...blankForm(), ...pick(parsed) });
    if (!parsed.name && !parsed.phone && !parsed.email) {
      notify('QR read, but no contact fields found — check the raw text.', 'warn');
    }
  }

  async function saveForm() {
    if (!form) return;
    const rec = { ...form, name: form.name.trim() };
    if (!rec.name && !rec.phone && !rec.email && !rec.company) {
      notify('Add at least a name, phone, email, or company.', 'warn');
      return;
    }
    // Persist locally first — never lose a lead.
    let list = upsertRecord({ ...rec, synced: false });
    setRecords(list);
    setForm(null);

    const res = await pushToSheet(endpoint, rec);
    if (res.ok) {
      list = updateRecord(rec.id, { synced: true, syncError: null });
      setRecords(list);
      notify('Saved to Google Sheet ✓', 'success');
    } else {
      list = updateRecord(rec.id, { synced: false, syncError: res.error });
      setRecords(list);
      notify(`Saved locally. Sheet sync failed: ${res.error}`, 'warn');
    }
  }

  async function syncAll() {
    if (!endpoint) {
      setShowSettings(true);
      return;
    }
    if (!unsynced.length) return;
    setSyncing(true);
    let done = 0;
    let failed = 0;
    for (const r of unsynced) {
      // eslint-disable-next-line no-await-in-loop
      const res = await pushToSheet(endpoint, r);
      if (res.ok) {
        setRecords(updateRecord(r.id, { synced: true, syncError: null }));
        done += 1;
      } else {
        setRecords(updateRecord(r.id, { syncError: res.error }));
        failed += 1;
      }
    }
    setSyncing(false);
    notify(failed ? `Synced ${done}, ${failed} still pending.` : `Synced ${done} lead(s) ✓`, failed ? 'warn' : 'success');
  }

  function removeRecord(id) {
    if (!confirm('Delete this lead?')) return;
    setRecords(deleteRecord(id));
  }

  function saveEndpoint(url) {
    setEndpoint(url);
    setEndpointState(getEndpoint()); // falls back to VITE_SHEET_ENDPOINT if cleared
    setShowSettings(false);
    notify('Google Sheet connected ✓', 'success');
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">◎</span>
          <div>
            <h1>Expo Lead Scanner</h1>
            <p className="sub">{records.length} leads · {unsynced.length} unsynced</p>
          </div>
        </div>
        <button className="icon-btn" onClick={() => setShowSettings(true)} aria-label="Settings">
          ⚙
        </button>
      </header>

      {!endpoint && (
        <button className="banner" onClick={() => setShowSettings(true)}>
          ⚠ Connect your Google Sheet to sync leads →
        </button>
      )}

      <main className="content">
        <div className="cta-row">
          <button className="btn primary big" onClick={() => setScanning(true)}>
            📷 Scan Badge
          </button>
          <button className="btn ghost big" onClick={() => setForm(blankForm())}>
            ＋ Add Manually
          </button>
        </div>

        <div className="list-head">
          <h2>Leads</h2>
          <div className="list-actions">
            <button
              className="chip"
              disabled={!unsynced.length || syncing}
              onClick={syncAll}
            >
              {syncing ? 'Syncing…' : `Sync (${unsynced.length})`}
            </button>
            <button
              className="chip"
              disabled={!records.length}
              onClick={() => downloadCSV(records)}
            >
              Export CSV
            </button>
          </div>
        </div>

        {records.length === 0 ? (
          <div className="empty">
            <p>No leads yet.</p>
            <p className="muted">Tap <b>Scan Badge</b> and point at a QR code to begin.</p>
          </div>
        ) : (
          <ul className="records">
            {records.map((r) => (
              <RecordCard key={r.id} rec={r} onEdit={() => setForm({ ...r })} onDelete={() => removeRecord(r.id)} />
            ))}
          </ul>
        )}
      </main>

      {scanning && <Scanner onResult={handleScan} onClose={() => setScanning(false)} />}

      {form && (
        <LeadForm
          form={form}
          setForm={setForm}
          onSave={saveForm}
          onCancel={() => setForm(null)}
          hasEndpoint={!!endpoint}
        />
      )}

      {showSettings && (
        <Settings
          endpoint={endpoint}
          onSave={saveEndpoint}
          onClose={() => setShowSettings(false)}
        />
      )}

      {toast && <div className={`toast ${toast.type}`}>{toast.message}</div>}
    </div>
  );
}

function pick(p) {
  return {
    name: p.name || '',
    phone: p.phone || '',
    email: p.email || '',
    company: p.company || '',
    position: p.position || '',
    website: p.website || '',
    notes: p.raw && !p.name && !p.phone && !p.email ? p.raw : '',
  };
}

function RecordCard({ rec, onEdit, onDelete }) {
  const tags = [
    rec.hotOrNot && { label: rec.hotOrNot, cls: `t-${rec.hotOrNot.toLowerCase()}` },
    rec.needToCall && { label: 'Call', cls: 't-call' },
    rec.ownDelivery && { label: 'Own Delivery', cls: 't-flag' },
    rec.petpooja && { label: 'Petpooja', cls: 't-flag' },
  ].filter(Boolean);

  return (
    <li className="record">
      <button className="record-main" onClick={onEdit}>
        <div className="record-top">
          <span className="record-name">{rec.name || rec.company || rec.phone || 'Untitled lead'}</span>
          <span className={`dot ${rec.synced ? 'ok' : 'pending'}`} title={rec.synced ? 'Synced' : 'Not synced'} />
        </div>
        {(rec.position || rec.company) && (
          <div className="record-line">{[rec.position, rec.company].filter(Boolean).join(' · ')}</div>
        )}
        {(rec.phone || rec.email) && (
          <div className="record-line muted">{[rec.phone, rec.email].filter(Boolean).join(' · ')}</div>
        )}
        {tags.length > 0 && (
          <div className="tags">
            {tags.map((t, i) => (
              <span key={i} className={`tag ${t.cls}`}>{t.label}</span>
            ))}
          </div>
        )}
      </button>
      <button className="record-del" onClick={onDelete} aria-label="Delete lead">🗑</button>
    </li>
  );
}

function LeadForm({ form, setForm, onSave, onCancel, hasEndpoint }) {
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="sheet-overlay" onClick={onCancel}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{form.name ? 'Edit lead' : 'New lead'}</h2>
          <button className="icon-btn" onClick={onCancel} aria-label="Close">✕</button>
        </div>

        <div className="sheet-body">
          <div className="divider first">Lead tags</div>

          <Field label="Hot or not">
            <div className="segmented">
              {['Hot', 'Warm', 'Cold'].map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`seg ${form.hotOrNot === v ? `active seg-${v.toLowerCase()}` : ''}`}
                  onClick={() => set('hotOrNot', form.hotOrNot === v ? '' : v)}
                >
                  {v}
                </button>
              ))}
            </div>
          </Field>

          <Toggle label="Need to call" checked={form.needToCall} onChange={(v) => set('needToCall', v)} />
          <Toggle label="Own delivery riders" checked={form.ownDelivery} onChange={(v) => set('ownDelivery', v)} />
          <Toggle label="Petpooja" checked={form.petpooja} onChange={(v) => set('petpooja', v)} />

          <Field label="Notes">
            <textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Anything to remember…" />
          </Field>

          <div className="divider">Contact details</div>

          <Field label="Date">
            <input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
          </Field>
          <Field label="Name">
            <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Full name" />
          </Field>
          <Field label="Phone">
            <input type="tel" inputMode="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="Phone number" />
          </Field>
          <Field label="Email">
            <input type="email" inputMode="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="name@company.com" />
          </Field>
          <Field label="Company">
            <input value={form.company} onChange={(e) => set('company', e.target.value)} placeholder="Company / organization" />
          </Field>
          <Field label="Position">
            <input value={form.position} onChange={(e) => set('position', e.target.value)} placeholder="Job title" />
          </Field>
          <Field label="Website">
            <input type="url" inputMode="url" value={form.website} onChange={(e) => set('website', e.target.value)} placeholder="https://…" />
          </Field>
        </div>

        <div className="sheet-foot">
          <button className="btn ghost" onClick={onCancel}>Cancel</button>
          <button className="btn primary" onClick={onSave}>
            {hasEndpoint ? 'Save & Sync' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <label className="toggle">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" aria-hidden />
    </label>
  );
}

function Settings({ endpoint, onSave, onClose }) {
  const [url, setUrl] = useState(endpoint);

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>Settings</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="sheet-body">
          <Field label="Google Apps Script Web App URL">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://script.google.com/macros/s/…/exec"
            />
          </Field>
          {ENV_ENDPOINT && (
            <p className="muted small">
              ✓ A default Sheet is connected from the deployment. Leave this blank to use it,
              or paste a URL to override on this device.
            </p>
          )}
          <p className="muted small">
            Follow <b>README.md → Connect your Google Sheet</b> to create this URL, then paste it
            here. It's stored only on this device.
          </p>
        </div>
        <div className="sheet-foot">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={() => onSave(url)}>Save</button>
        </div>
      </div>
    </div>
  );
}
