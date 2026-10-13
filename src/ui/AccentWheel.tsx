import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { accentForSetting, accentFromHue, EMBER_HUE, normaliseHue } from '@/domain/accent';
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

/**
 * Settings → Look: a colour wheel for the accent. Dragging previews live across the whole app;
 * letting go saves. A slider under it does the same for keyboard and screen reader. The wheel picks
 * a hue; the colour is lifted where needed so text on it and in it still reads (src/domain/accent.ts).
 */
export function AccentWheel({ settings }: { settings: Settings }) {
  const stored = settings.accentHue;
  const [hue, setHue] = useState<number>(stored ?? EMBER_HUE);
  const [dragging, setDragging] = useState(false);
  const last = useRef<number | undefined>(stored);
  // A restore or a reset can change the stored hue under the wheel; follow it.
  useEffect(() => {
    last.current = stored;
    setHue(stored ?? EMBER_HUE);
  }, [stored]);
  const isEmber = stored === undefined && hue === EMBER_HUE && !dragging;
  const colours = accentForSetting(isEmber ? undefined : hue);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const preview = (h: number) => {
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
            setHue(last.current ?? EMBER_HUE);
          }}
        >
          <div className="absolute inset-[22%] flex items-center justify-center rounded-full bg-bg">
            <span className="h-10 w-10 rounded-full border border-line" style={{ background: colours.accent }} data-testid="accent-swatch" />
          </div>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-1/2 h-5 w-5 rounded-full border-2 border-fg"
            style={{ transform: `translate(-50%, -50%) rotate(${hue}deg) translateY(-3.95rem)` }}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="label">Accent</div>
          <div className="num mt-1 text-2xl font-bold" data-testid="accent-value">
            {isEmber ? 'Ember' : colours.accent.toUpperCase()}
          </div>
          <Button size="sm" variant="outline" className="mt-3" disabled={stored === undefined} onClick={() => {
            setHue(EMBER_HUE);
            applyAccent(undefined);
            commit(undefined);
          }} data-testid="accent-reset">
            Ember
          </Button>
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
