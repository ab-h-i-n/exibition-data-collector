import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

const READER_ID = 'qr-reader';

// Full-screen camera overlay. Calls onResult(decodedText) once, then stops.
// Adds a zoom slider + torch toggle when the device's camera supports them
// (works on most Android browsers; iOS Safari usually doesn't expose these).
export default function Scanner({ onResult, onClose }) {
  const scannerRef = useRef(null);
  const trackRef = useRef(null);
  const handledRef = useRef(false);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(null); // { min, max, step, value } | null
  const [torch, setTorch] = useState({ supported: false, on: false });

  useEffect(() => {
    const html5 = new Html5Qrcode(READER_ID, {
      verbose: false,
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
    });
    scannerRef.current = html5;

    // No qrbox → decode the FULL frame instead of a small center box, so a QR
    // that's further away (and smaller in the frame) can still be read. Higher
    // fps gives more chances to catch a sharply-focused frame.
    const config = { fps: 15 };

    const handle = (decodedText) => {
      if (handledRef.current) return;
      handledRef.current = true;
      stop().finally(() => onResult(decodedText));
    };

    const stop = async () => {
      try {
        if (html5.isScanning) await html5.stop();
        html5.clear();
      } catch {
        /* ignore stop errors */
      }
    };

    const onStarted = () => {
      setReady(true);
      detectCapabilities(0);
    };

    // The live video track exposes zoom/torch capabilities a moment after start.
    const detectCapabilities = (tries) => {
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
    };

    // Ask for a high-resolution stream so a small/distant QR carries enough
    // detail to decode from further away (default is often just 480p/720p).
    const hi = { width: { ideal: 1920 }, height: { ideal: 1080 } };

    html5
      .start({ facingMode: { exact: 'environment' }, ...hi }, config, handle, () => {})
      .then(onStarted)
      .catch(() =>
        html5
          .start({ facingMode: 'environment', ...hi }, config, handle, () => {})
          .then(onStarted)
          .catch(async () => {
            try {
              const cams = await Html5Qrcode.getCameras();
              if (!cams?.length) throw new Error('No camera found');
              const back =
                cams.find((c) => /back|rear|environment/i.test(c.label)) || cams[cams.length - 1];
              await html5.start({ deviceId: { exact: back.id }, ...hi }, config, handle, () => {});
              onStarted();
            } catch (e) {
              setError(cameraError(e));
            }
          })
      );

    return () => {
      handledRef.current = true;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function getTrack() {
    const video = document.querySelector(`#${READER_ID} video`);
    const stream = video && video.srcObject;
    return stream && stream.getVideoTracks ? stream.getVideoTracks()[0] : null;
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
          <button className="btn primary" onClick={onClose}>
            Enter manually instead
          </button>
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
  return `Could not start the camera: ${msg}`;
}
