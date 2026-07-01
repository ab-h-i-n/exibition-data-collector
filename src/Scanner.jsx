import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

const READER_ID = 'qr-reader';

// Full-screen camera overlay. Calls onResult(decodedText) once, then stops.
export default function Scanner({ onResult, onClose }) {
  const scannerRef = useRef(null);
  const handledRef = useRef(false);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const html5 = new Html5Qrcode(READER_ID, {
      verbose: false,
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
    });
    scannerRef.current = html5;

    // No qrbox → html5-qrcode decodes the ENTIRE camera frame instead of only a
    // center box, so a small QR anywhere in view is read (with a qrbox, the code
    // had to roughly fill the on-screen box to scan).
    const config = {
      fps: 12,
    };

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

    // Prefer the rear camera. Fall back to enumerating cameras if the
    // facingMode constraint is rejected (happens on some Android browsers).
    html5
      .start({ facingMode: { exact: 'environment' } }, config, handle, () => {})
      .then(() => setReady(true))
      .catch(() =>
        html5
          .start({ facingMode: 'environment' }, config, handle, () => {})
          .then(() => setReady(true))
          .catch(async () => {
            try {
              const cams = await Html5Qrcode.getCameras();
              if (!cams?.length) throw new Error('No camera found');
              const back =
                cams.find((c) => /back|rear|environment/i.test(c.label)) || cams[cams.length - 1];
              await html5.start({ deviceId: { exact: back.id } }, config, handle, () => {});
              setReady(true);
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

  return (
    <div className="scanner-overlay">
      <div className="scanner-topbar">
        <span className="scanner-title">Scan badge QR</span>
        <button className="icon-btn light" onClick={onClose} aria-label="Close scanner">
          ✕
        </button>
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
