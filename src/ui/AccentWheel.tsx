import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { accentForSetting, accentFromHue, BRASS_HUE, normaliseHue, WHITE_HUE } from '@/domain/accent';
import { saveSettings } from '@/db/repo';
import type { Settings } from '@/domain/types';
import { Button } from './components/Button';
import { Card } from './components/Card';
import { applyAccent } from './accentTheme';

/** The ring is painted with the colours the wheel actually produces, so what is touched is what is applied. */
const RING = `conic-gradient(${Array.from({ length: 13 }, (_, i) => `${accentFromHue(i * 30).accent} ${i * 30}deg`).join(', ')})`;

/** Hue for a point on the ring: 0° at the top, clockwise, matching the conic gradient. */
function hueAt(e: PointerEvent<HTMLDivElement>): number {
  const r = e.currentTarget.getBoundingClientRect();
  const dx = e.clientX - (r.left + r.width / 2);
  const dy = e.clientY - (r.top + r.height / 2);
  return normaliseHue((Math.atan2(dx, -dy) * 180) / Math.PI);
}

/** Where the wheel's knob and slider sit for a stored setting: the default brass and white are not on the wheel. */
const wheelHue = (stored: number | undefined) => (stored === undefined || stored === WHITE_HUE ? BRASS_HUE : stored);

/**
 * Settings → Look: a colour wheel for the accent. Dragging previews live across the whole app;
 * letting go saves. A slider under it does the same for keyboard and screen reader. The wheel picks
 * a hue; the colour is lifted where needed so text on it and in it still reads (src/domain/accent.ts).
 * White is a button beside Brass, since no hue gives it.
 */
export function AccentWheel({ settings }: { settings: Settings }) {
  const stored = settings.accentHue;
  const [hue, setHue] = useState<number>(wheelHue(stored));
  const [white, setWhite] = useState(stored === WHITE_HUE);
  const [dragging, setDragging] = useState(false);
  const last = useRef<number | undefined>(stored);
  // A restore or a reset can change the stored hue under the wheel; follow it.
  useEffect(() => {
    last.current = stored;
    setHue(wheelHue(stored));
    setWhite(stored === WHITE_HUE);
  }, [stored]);
  const isDefault = stored === undefined && hue === BRASS_HUE && !dragging;
  const colours = accentForSetting(white ? WHITE_HUE : isDefault ? undefined : hue);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const preview = (h: number) => {
    setWhite(false);
    setHue(h);
    applyAccent(h);
  };
  const commit = (h: number | undefined) => {
    clearTimeout(saveTimer.current);
    last.current = h;
    void saveSettings({ accentHue: h });
  };
  /** The slider saves once it has been still for a moment, however it was moved (drag, keys, a screen reader). */
  const commitSoon = (h: number) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => commit(h), 400);
  };

  return (
    <Card className="p-4" data-testid="accent-card">
      <div className="flex items-center gap-5">
        <div
          role="presentation"
          data-testid="accent-wheel"
          className="relative h-36 w-36 shrink-0 touch-none rounded-full"
          style={{ background: RING }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            setDragging(true);
            preview(hueAt(e));
          }}
          onPointerMove={(e) => dragging && preview(hueAt(e))}
          onPointerUp={(e) => {
            setDragging(false);
            commit(hueAt(e));
          }}
          onPointerCancel={() => {
            setDragging(false);
            applyAccent(last.current);
            setHue(wheelHue(last.current));
            setWhite(last.current === WHITE_HUE);
          }}
        >
          <div className="absolute inset-[22%] flex items-center justify-center rounded-full bg-bg">
            <span className="h-10 w-10 rounded-full border border-line" style={{ background: colours.accent }} data-testid="accent-swatch" />
          </div>
          {!white && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute left-1/2 top-1/2 h-5 w-5 rounded-full border-2 border-fg"
              style={{ transform: `translate(-50%, -50%) rotate(${hue}deg) translateY(-3.95rem)` }}
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="label">Accent</div>
          <div className="num mt-1 text-2xl font-bold" data-testid="accent-value">
            {white ? 'White' : isDefault ? 'Brass' : colours.accent.toUpperCase()}
          </div>
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="outline" disabled={stored === undefined} onClick={() => {
              setWhite(false);
              setHue(BRASS_HUE);
              applyAccent(undefined);
              commit(undefined);
            }} data-testid="accent-reset">
              Brass
            </Button>
            <Button size="sm" variant="outline" disabled={white} onClick={() => {
              setWhite(true);
              applyAccent(WHITE_HUE);
              commit(WHITE_HUE);
            }} data-testid="accent-white">
              White
            </Button>
          </div>
        </div>
      </div>
      <label className="mt-4 block">
        <span className="sr-only">Accent hue</span>
        <input
          type="range"
          min={0}
          max={359}
          step={1}
          value={hue}
          data-testid="accent-hue"
          onChange={(e) => {
            preview(Number(e.target.value));
            commitSoon(Number(e.target.value));
          }}
          className="h-11 w-full accent-[var(--c-accent)]"
        />
      </label>
    </Card>
  );
}
