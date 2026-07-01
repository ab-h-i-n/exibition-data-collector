import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

const READER_ID = 'qr-reader';

// Full-screen camera overlay. Calls onResult(decodedText) once, then stops.
// Startup is resilient: it tries a high-res rear camera first, then falls back
// through safer constraints, with a per-attempt timeout so a hung attempt can't
// freeze on "Starting camera…". Shows a Retry button if it ultimately fails.
// Also exposes zoom + torch when the device supports them.
export default function Scanner({ onResult, onClose }) {
  const scannerRef = useRef(null);
  const trackRef = useRef(null);
  const handledRef = useRef(false);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [zoom, setZoom] = useState(null); // { min, max, step, value } | null
  const [torch, setTorch] = useState({ supported: false, on: false });

  useEffect(() => {
    handledRef.current = false;
    let settled = false;
    let disposed = false;

    const html5 = new Html5Qrcode(READER_ID, {
      verbose: false,
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
    });
    scannerRef.current = html5;

    const config = {
      fps: 15,
      qrbox: (vw, vh) => {
        const s = Math.floor(Math.min(vw, vh) * 0.8);
        return { width: s, height: s };
      },
      aspectRatio: 1.0,
      // Resolution/facingMode must go here (NOT in the first start() arg, which
      // html5-qrcode requires to be a single-key camera selector). Higher res
      // helps read smaller / further-away QR codes.
      videoConstraints: {
        facingMode: 'environment',
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    };

    const handle = (text) => {
      if (handledRef.current) return;
      handledRef.current = true;
      stop().finally(() => onResult(text));
    };

    const stop = async () => {
      try {
        if (html5.isScanning) await html5.stop();
        html5.clear();
      } catch {
        /* ignore */
      }
    };

    const markStarted = () => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      setReady(true);
      setTimeout(() => detectCapabilities(0), 300);
    };

    const fail = (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      setError(cameraError(e));
    };

    // IMPORTANT: html5-qrcode's start() must NOT be raced/abandoned or called
    // again while it's in-flight — that throws "Cannot transition to a new
    // state, already under transition". So we do exactly ONE start() per mount;
    // on failure the user taps Retry, which remounts a fresh instance.
    const start = async () => {
      try {
        // First arg is a single-key camera selector; the detailed constraints
        // (resolution) come from config.videoConstraints above.
        await html5.start({ facingMode: 'environment' }, config, handle, () => {});
        if (disposed) {
          await stop(); // unmounted mid-start — release the camera
          return;
        }
        markStarted();
      } catch (e) {
        if (!disposed) fail(e);
      }
    };

    // Backstop if start() never settles (e.g. permission dialog left unanswered).
    // It only shows a message — it never touches the scanner, so it cannot
    // itself trigger a transition error.
    const watchdog = setTimeout(() => {
      if (settled || disposed) return;
      settled = true;
      setError("Camera didn't start. Tap Retry, or enter the lead manually.");
    }, 20000);

    start();

    return () => {
      disposed = true;
      handledRef.current = true;
      clearTimeout(watchdog);
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  function getTrack() {
    const video = document.querySelector(`#${READER_ID} video`);
    const stream = video && video.srcObject;
    return stream && stream.getVideoTracks ? stream.getVideoTracks()[0] : null;
  }

  function detectCapabilities(tries) {
    const track = getTrack();
    if (!track) {
      if (tries < 6) setTimeout(() => detectCapabilities(tries + 1), 200);
      return;
    }
    trackRef.current = track;
    if (typeof track.getCapabilities !== 'function') return;
    let caps = {};
    try {
      caps = track.getCapabilities() || {};
    } catch {
      return;
    }
    if (caps.zoom && Number(caps.zoom.max) > Number(caps.zoom.min)) {
      const min = Number(caps.zoom.min) || 1;
      const max = Number(caps.zoom.max) || 1;
      const step = Number(caps.zoom.step) || 0.1;
      let value = min;
      try {
        value = Number(track.getSettings().zoom) || min;
      } catch {
        /* ignore */
      }
      setZoom({ min, max, step, value });
    }
    if (caps.torch) setTorch((t) => ({ ...t, supported: true }));
    // Continuous autofocus keeps far / angled badges sharp enough to decode.
    if (Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) {
      track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
    }
  }

  async function applyZoom(value) {
    setZoom((z) => (z ? { ...z, value } : z));
    const track = trackRef.current;
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ zoom: value }] });
    } catch {
      try {
        await track.applyConstraints({ zoom: value });
      } catch {
        /* ignore */
      }
    }
  }

  function nudgeZoom(dir) {
    if (!zoom) return;
    const jump = (zoom.step || 0.1) * 4;
    const next = Math.min(zoom.max, Math.max(zoom.min, +(zoom.value + dir * jump).toFixed(3)));
    applyZoom(next);
  }

  async function toggleTorch() {
    const track = trackRef.current;
    if (!track) return;
    const next = !torch.on;
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] });
      setTorch((t) => ({ ...t, on: next }));
    } catch {
      /* ignore */
    }
  }

  function retry() {
    setError('');
    setReady(false);
    setZoom(null);
    setTorch({ supported: false, on: false });
    trackRef.current = null;
    setAttempt((a) => a + 1);
  }

  return (
    <div className="scanner-overlay">
      <div className="scanner-topbar">
        <span className="scanner-title">Scan badge QR</span>
        <div className="scanner-actions">
          {torch.supported && (
            <button
              className={`icon-btn light ${torch.on ? 'active' : ''}`}
              onClick={toggleTorch}
              aria-label="Toggle flashlight"
            >
              {torch.on ? '🔦' : '💡'}
            </button>
          )}
          <button className="icon-btn light" onClick={onClose} aria-label="Close scanner">
            ✕
          </button>
        </div>
      </div>

      <div id={READER_ID} className="scanner-view" />

      {!error && ready && zoom && (
        <div className="zoom-bar">
          <button className="zoom-btn" onClick={() => nudgeZoom(-1)} aria-label="Zoom out">
            −
          </button>
          <input
            type="range"
            min={zoom.min}
            max={zoom.max}
            step={zoom.step || 0.1}
            value={zoom.value}
            onChange={(e) => applyZoom(parseFloat(e.target.value))}
            aria-label="Camera zoom"
          />
          <button className="zoom-btn" onClick={() => nudgeZoom(1)} aria-label="Zoom in">
            ＋
          </button>
        </div>
      )}

      {!error && (
        <div className="scanner-hint">
          {!ready
            ? 'Starting camera…'
            : zoom
            ? 'Point at the QR · slide to zoom'
            : 'Point at the QR code on the badge'}
        </div>
      )}

      {error && (
        <div className="scanner-error">
          <p>{error}</p>
          <div className="scanner-error-actions">
            <button className="btn primary" onClick={retry}>
              Retry camera
            </button>
            <button className="btn light-outline" onClick={onClose}>
              Enter manually
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function cameraError(e) {
  const msg = String(e?.message || e);
  if (/NotAllowedError|Permission/i.test(msg))
    return 'Camera permission denied. Allow camera access in your browser settings, then reopen.';
  if (/NotFoundError|No camera/i.test(msg)) return 'No camera was found on this device.';
  if (/NotReadableError|in use/i.test(msg))
    return 'Camera is busy — close other apps using it and try again.';
  if (/secure|https/i.test(msg))
    return 'Camera needs a secure page. Open the site over HTTPS (or on localhost).';
  if (/start-timeout/i.test(msg))
    return 'Camera took too long to start. Tap Retry, or enter the lead manually.';
  return `Could not start the camera: ${msg}`;
}
