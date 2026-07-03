import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

const READER_ID = 'qr-reader';
const AUX_LENS = /ultra|telephoto|\btele\b|depth|macro|monochrome|\bmono\b|infrared|\bir\b|fisheye/i;
const BACK = /back|rear/i;
const FRONT = /front|user|face|selfie/i;

// From a list of REAR cameras, prefer the main (wide) lens — skip ultra-wide,
// telephoto, depth, macro, mono. Input is rear-only, so it never returns front.
function pickMainBack(rear) {
  const mains = rear.filter((c) => !AUX_LENS.test(c.label || ''));
  return (
    mains.find((c) => /(^|\s)(back|rear)\s*camera\s*$/i.test((c.label || '').trim())) ||
    mains[0] ||
    rear[0]
  );
}

// Full-screen camera overlay. Calls onResult(decodedText) once, then stops.
export default function Scanner({ onResult, onClose }) {
  const html5Ref = useRef(null);
  const listRef = useRef([]); // cameras the 🔄 button cycles (rear lenses)
  const idxRef = useRef(-1);
  const busyRef = useRef(false);
  const handledRef = useRef(false);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [canSwitch, setCanSwitch] = useState(false);

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

  const startById = (id) =>
    html5Ref.current.start({ deviceId: { exact: id } }, CONFIG, onDecode, () => {});

  // "Any rear camera" — reliable, and never the front camera.
  const startRear = async () => {
    const h = html5Ref.current;
    try {
      await h.start({ facingMode: { exact: 'environment' } }, CONFIG, onDecode, () => {});
    } catch {
      await h.start({ facingMode: 'environment' }, CONFIG, onDecode, () => {});
    }
  };

  useEffect(() => {
    const h = new Html5Qrcode(READER_ID, {
      verbose: false,
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
    });
    html5Ref.current = h;
    let cancelled = false;

    (async () => {
      let started = false;
      try {
        // Permission first so device labels are populated.
        const probe = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        probe.getTracks().forEach((t) => t.stop());

        const cams = (await Html5Qrcode.getCameras()) || [];
        const rear = cams.filter((c) => BACK.test(c.label || ''));
        // Switch list: identified rear cameras, else all NON-front cameras.
        const list = rear.length ? rear : cams.filter((c) => !FRONT.test(c.label || ''));
        listRef.current = list;

        if (!cancelled && rear.length) {
          // We can identify the rear lenses → start on the MAIN one.
          const main = pickMainBack(rear);
          idxRef.current = list.findIndex((c) => c.id === main.id);
          await startById(main.id);
          started = true;
        }
        if (!cancelled) setCanSwitch(list.length > 1);
      } catch {
        /* fall through to a plain rear-camera start */
      }

      // Default path (labels unclear / enumeration failed): a guaranteed REAR
      // camera via facingMode — this is what stops it ever opening the front cam.
      if (!started && !cancelled) {
        try {
          idxRef.current = -1; // first 🔄 tap -> list[0]
          await startRear();
          started = true;
        } catch (e) {
          if (!cancelled) setError(cameraError(e));
          return;
        }
      }
      if (started && !cancelled) setReady(true);
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

  // Cycle to the next camera in the list (rear lenses). Guarded against
  // double-taps; falls back to any rear camera if a deviceId is rejected.
  const switchCamera = async () => {
    const h = html5Ref.current;
    const list = listRef.current;
    if (!h || list.length < 2 || busyRef.current) return;
    busyRef.current = true;
    setReady(false);
    setError('');
    try {
      if (h.isScanning) await h.stop();
      idxRef.current = (idxRef.current + 1) % list.length;
      await startById(list[idxRef.current].id);
      setReady(true);
    } catch {
      try {
        await startRear();
        setReady(true);
      } catch (e2) {
        setError(cameraError(e2));
      }
    } finally {
      busyRef.current = false;
    }
  };

  return (
    <div className="scanner-overlay">
      <div className="scanner-topbar">
        <span className="scanner-title">Scan badge QR</span>
        <div className="scanner-actions">
          {canSwitch && (
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
