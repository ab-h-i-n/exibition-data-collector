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

    // A start() that rejects if it doesn't come up within `ms` — prevents a
    // single stalled camera request from hanging the whole overlay forever.
    const startWithTimeout = (source, ms) =>
      Promise.race([
        html5.start(source, config, handle, () => {}),
        new Promise((_, rej) => setTimeout(() => rej(new Error('start-timeout')), ms)),
      ]);

    // Best range first (rear + 1080p), then progressively safer fallbacks.
    const sources = [
      { facingMode: { exact: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      { facingMode: 'environment' },
    ];

    const run = async () => {
      let lastErr = null;
      for (const source of sources) {
        try {
          await startWithTimeout(source, 6000);
          return markStarted();
        } catch (e) {
          lastErr = e;
          await stop(); // cancel a failed/stalled attempt before the next
        }
      }
      // Last resort: enumerate cameras and start the rear one by id.
      try {
        const cams = (await Html5Qrcode.getCameras()) || [];
        const back =
          cams.find((c) => /back|rear|environment/i.test(c.label)) || cams[cams.length - 1];
        if (!back) throw new Error('No camera found');
        await startWithTimeout(back.id, 8000);
        return markStarted();
      } catch (e) {
        fail(e || lastErr);
      }
    };

    // Final backstop for the "permission dialog never answered" case.
    const watchdog = setTimeout(() => {
      if (settled) return;
      settled = true;
      setError("Camera didn't start. Tap Retry, or enter the lead manually.");
    }, 30000);

    run();

    return () => {
      handledRef.current = true;
      settled = true;
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
