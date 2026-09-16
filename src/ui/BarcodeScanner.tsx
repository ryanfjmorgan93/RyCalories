import { useEffect, useRef, useState } from 'react';
import { BarcodeDetector, prepareZXingModule } from 'barcode-detector/ponyfill';
import zxingWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { Button } from './components/Button';
import { Chip } from './components/Chip';
import { Sheet } from './components/Sheet';

/**
 * The ponyfill's default `locateFile` points at a jsDelivr CDN — fine online, useless the moment
 * the phone loses signal. The wasm is bundled and precached by the service worker (see
 * vite.config.ts's workbox globs), so it only ever needs to be served from here. Configured once,
 * at module load, before any `BarcodeDetector` is constructed or used.
 */
prepareZXingModule({
  overrides: {
    locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? zxingWasmUrl : prefix + path),
  },
});

/**
 * One detector, reused across every scan and every mount of this component. It carries no
 * per-scan state, only the format list, so there is nothing to gain from recreating it and a real
 * cost (re-touching the wasm module) in doing so.
 */
const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });

/** How often a frame is checked. A tick never starts before the previous one has finished. */
const DETECT_INTERVAL_MS = 150;

type CameraError = 'no-media' | 'denied';

/** A capability/constraint pair MediaStreamTrack's DOM types do not know about, but every mobile
 * Chromium does. */
type TorchCapabilities = MediaTrackCapabilities & { torch?: boolean };

/**
 * Camera barcode scanner, shown as a sheet. It does exactly one thing: turn either a camera
 * decode or a typed-in number into a code and hand it to `onCode`. It knows nothing about
 * products, labels or nutrition — that is entirely the caller's business.
 */
export function BarcodeScanner({
  open,
  onClose,
  onCode,
}: {
  open: boolean;
  onClose: () => void;
  onCode: (code: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  // Set the instant a code is found or the sheet starts closing, so an in-flight detect() promise
  // that resolves a moment later cannot schedule another tick, stop already-stopped tracks twice,
  // or call onCode a second time.
  const stoppedRef = useRef(false);

  const [cameraError, setCameraError] = useState<CameraError | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [digits, setDigits] = useState('');

  const stopAll = () => {
    stoppedRef.current = true;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setTorchAvailable(false);
    setTorchOn(false);
  };

  useEffect(() => {
    if (!open) {
      stopAll();
      return;
    }
    stoppedRef.current = false;
    setCameraError(null);
    setDigits('');

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setCameraError('no-media');
      return;
    }

    let cancelled = false;

    const runDetectLoop = () => {
      const tick = async () => {
        if (cancelled || stoppedRef.current) return;
        const video = videoRef.current;
        // A frame the video element has not decoded yet cannot be handed to the detector — it
        // would either throw or, worse, silently detect nothing forever on a black frame.
        if (video && video.readyState >= 2) {
          try {
            const codes = await detector.detect(video);
            if (codes.length > 0 && !cancelled && !stoppedRef.current) {
              const code = codes[0]!.rawValue;
              stopAll();
              onCode(code);
              return;
            }
          } catch {
            // A frame that fails to decode is the normal case on every tick but the last one.
          }
        }
        if (!cancelled && !stoppedRef.current) {
          timerRef.current = window.setTimeout(() => void tick(), DETECT_INTERVAL_MS);
        }
      };
      void tick();
    };

    const start = async () => {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
        });
      } catch {
        if (!cancelled) setCameraError('denied');
        return;
      }
      // The sheet was closed while permission was pending: this stream was never wanted.
      if (cancelled || stoppedRef.current) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        void video.play().catch(() => {});
      }
      const caps = stream.getVideoTracks()[0]?.getCapabilities?.() as TorchCapabilities | undefined;
      if (caps?.torch) setTorchAvailable(true);

      runDetectLoop();
    };

    void start();

    return () => {
      cancelled = true;
      stopAll();
    };
  }, [open]);

  const toggleTorch = () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    track
      .applyConstraints({ advanced: [{ torch: next }] } as unknown as MediaTrackConstraints)
      .then(() => setTorchOn(next))
      .catch(() => {
        // A torch that refuses the constraint stays off; nothing else changes.
      });
  };

  const submitDigits = () => {
    const code = digits.trim();
    if (!code) return;
    stopAll();
    onCode(code);
  };

  return (
    <Sheet open={open} onClose={onClose} title="Scan barcode">
      <div className="grid gap-4">
        {!cameraError && (
          <div className="relative overflow-hidden rounded-2xl bg-black">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption -- a live decode feed, not media content */}
            <video ref={videoRef} playsInline muted autoPlay className="aspect-[3/4] w-full object-cover" />
            {torchAvailable && (
              <div className="absolute bottom-3 right-3">
                <Chip active={torchOn} onClick={toggleTorch} tone="accent">
                  Torch
                </Chip>
              </div>
            )}
          </div>
        )}
        {cameraError === 'no-media' && <div className="px-1 text-sm text-muted">Camera not available on this device.</div>}
        {cameraError === 'denied' && <div className="px-1 text-sm text-muted">Camera not available.</div>}

        <div className="grid gap-2">
          <div className="px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Or enter the barcode</div>
          <input
            data-testid="barcode-input"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            enterKeyHint="done"
            value={digits}
            onChange={(e) => setDigits(e.target.value.replace(/\D/g, '').slice(0, 14))}
            placeholder="Barcode number"
            className="num h-14 w-full rounded-xl border border-line bg-surface-2 px-3 text-center text-xl font-bold outline-none focus:border-accent placeholder:text-dim"
          />
          <Button size="lg" variant="outline" full disabled={digits.length === 0} data-testid="barcode-submit" onClick={submitDigits}>
            Use barcode
          </Button>
        </div>

        <Button size="lg" variant="secondary" full onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Sheet>
  );
}
