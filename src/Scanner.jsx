import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

const READER_ID = 'qr-reader';

// Pick the MAIN (wide) rear camera. On multi-lens phones, facingMode:'environment'
// often hands back the ULTRA-WIDE lens (especially on Android) — wider field of
// view + worse close focus, which makes QR codes hard to decode. Prefer a rear
// camera whose label isn't an ultra-wide / telephoto / depth / macro lens.
function pickMainBack(cams) {
  const backs = cams.filter((c) => /back|rear|environment/i.test(c.label));
  const pool = backs.length ? backs : cams;
  const AUX = /ultra|telephoto|\btele\b|depth|macro|monochrome|\bmono\b|infrared|\bir\b|fisheye/i;
  const mains = pool.filter((c) => !AUX.test(c.label || ''));
  return (
    mains.find((c) => /(^|\s)(back|rear)\s*camera\s*$/i.test((c.label || '').trim())) ||
    mains[0] ||
    pool[0]
  );
}

// Full-screen camera overlay. Calls onResult(decodedText) once, then stops.
export default function Scanner({ onResult, onClose }) {
  const html5Ref = useRef(null);
  const camsRef = useRef([]); // rear cameras, main first
  const idxRef = useRef(0);
  const handledRef = useRef(false);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [multiCam, setMultiCam] = useState(false);

  // Resolution lives in videoConstraints (a high-res rear stream keeps enough
  // pixels-per-module to decode a dense QR at arm's length). The camera itself is
  // chosen by deviceId in the first start() arg — NOT facingMode — so we get the
  // main lens instead of whatever "environment" defaults to.
  const CONFIG = {
    fps: 12,
    videoConstraints: { width: { ideal: 1920 }, height: { ideal: 1080 } },
  };

  const onDecode = (decodedText) => {
    if (handledRef.current) return;
    handledRef.current = true;
    const h = html5Ref.current;
    (async () => {
      try {
        if (h?.isScanning) await h.stop();
        h?.clear();
      } catch {
        /* ignore */
      }
    })().finally(() => onResult(decodedText));
  };

  const startCamera = async (cameraId) => {
    const h = html5Ref.current;
    await h.start(
      cameraId ? { deviceId: { exact: cameraId } } : { facingMode: 'environment' },
      CONFIG,
      onDecode,
      () => {},
    );
  };

  useEffect(() => {
    const h = new Html5Qrcode(READER_ID, {
      verbose: false,
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
    });
    html5Ref.current = h;
    let cancelled = false;

    (async () => {
      try {
        // Permission first so device labels are populated for enumeration.
        const probe = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        probe.getTracks().forEach((t) => t.stop());

        const cams = await Html5Qrcode.getCameras();
        if (!cams?.length) throw new Error('No camera found');
        const backs = cams.filter((c) => /back|rear|environment/i.test(c.label));
        const pool = backs.length ? backs : cams;
        const main = pickMainBack(cams);
        camsRef.current = [main, ...pool.filter((c) => c.id !== main.id)];
        idxRef.current = 0;
        if (cancelled) return;
        setMultiCam(camsRef.current.length > 1);
        await startCamera(main.id);
        if (!cancelled) setReady(true);
      } catch {
        // Fallback: let the browser pick a rear camera (enumeration/labels
        // unavailable, e.g. permission quirks on some Android browsers).
        try {
          if (cancelled) return;
          await startCamera(null);
          if (!cancelled) setReady(true);
        } catch (e2) {
          if (!cancelled) setError(cameraError(e2));
        }
      }
    })();

    return () => {
      handledRef.current = true;
      cancelled = true;
      (async () => {
        try {
          if (h.isScanning) await h.stop();
          h.clear();
        } catch {
          /* ignore */
        }
      })();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cycle to the next rear camera — the escape hatch when the auto-picked lens
  // is still wrong (e.g. Androids that expose only generic "camera2 N" labels).
  const switchCamera = async () => {
    const h = html5Ref.current;
    const cams = camsRef.current;
    if (!h || cams.length < 2) return;
    setReady(false);
    try {
      if (h.isScanning) await h.stop();
      idxRef.current = (idxRef.current + 1) % cams.length;
      await startCamera(cams[idxRef.current].id);
      setReady(true);
    } catch (e) {
      setError(cameraError(e));
    }
  };

  return (
    <div className="scanner-overlay">
      <div className="scanner-topbar">
        <span className="scanner-title">Scan badge QR</span>
        <div className="scanner-actions">
          {multiCam && (
            <button
              className="icon-btn light"
              onClick={switchCamera}
              aria-label="Switch camera"
              title="Switch camera (if the wrong lens is used)"
            >
              🔄
            </button>
          )}
          <button className="icon-btn light" onClick={onClose} aria-label="Close scanner">
            ✕
          </button>
        </div>
      </div>

      <div id={READER_ID} className="scanner-view" />

      {!error && (
        <div className="scanner-hint">
          {ready ? 'Point at the QR code on the badge' : 'Starting camera…'}
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
