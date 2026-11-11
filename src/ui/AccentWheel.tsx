import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { accentForSetting, accentFromHue, BRASS, BRASS_HUE, normaliseHue, PRESETS } from '@/domain/accent';
import { saveSettings } from '@/db/repo';
import type { Settings } from '@/domain/types';
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

/** Where the wheel's knob and slider sit for a stored setting: brass and the named presets are not on the wheel. */
const wheelHue = (stored: number | undefined) => (stored === undefined || stored < 0 ? BRASS_HUE : stored);
/** The named preset a stored value is, if it is one. */
const presetOf = (stored: number | undefined) => (stored !== undefined && stored < 0 ? stored : null);

/**
 * Settings → Look: a colour wheel for the accent. Dragging previews live across the whole app;
 * letting go saves. A slider under it does the same for keyboard and screen reader. The wheel picks
 * a hue; the colour is lifted where needed so text on it and in it still reads (src/domain/accent.ts).
 * Brass and the named presets (White, Jade, Cobalt, Coral) are swatches under it, one tap each.
 */
export function AccentWheel({ settings }: { settings: Settings }) {
  const stored = settings.accentHue;
  const [hue, setHue] = useState<number>(wheelHue(stored));
  const [preset, setPreset] = useState<number | null>(presetOf(stored));
  const [dragging, setDragging] = useState(false);
  const last = useRef<number | undefined>(stored);
  // A restore or a reset can change the stored hue under the wheel; follow it.
  useEffect(() => {
    last.current = stored;
    setHue(wheelHue(stored));
    setPreset(presetOf(stored));
  }, [stored]);
  const isDefault = stored === undefined && hue === BRASS_HUE && !dragging;
  const colours = accentForSetting(preset ?? (isDefault ? undefined : hue));
  const named = preset !== null ? PRESETS.find((p) => p.hue === preset)?.name : undefined;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const preview = (h: number) => {
    setPreset(null);
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
            setPreset(presetOf(last.current));
          }}
        >
          <div className="absolute inset-[22%] flex items-center justify-center rounded-full bg-bg">
            <span className="h-10 w-10 rounded-full border border-line" style={{ background: colours.accent }} data-testid="accent-swatch" />
          </div>
          {preset === null && (
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
            {named ?? (isDefault ? 'Brass' : colours.accent.toUpperCase())}
          </div>
        </div>
      </div>
      {/* The named presets: one tap each, the one in use filled. */}
      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Presets">
        <Swatch
          name="Brass"
          colour={BRASS.accent}
          on={stored === undefined && preset === null}
          testId="accent-reset"
          onPick={() => {
            setPreset(null);
            setHue(BRASS_HUE);
            applyAccent(undefined);
            commit(undefined);
          }}
        />
        {PRESETS.map((p) => (
          <Swatch
            key={p.hue}
            name={p.name}
            colour={p.accent}
            on={preset === p.hue}
            testId={`accent-${p.name.toLowerCase().replace(/\s+/g, '-')}`}
            onPick={() => {
              setPreset(p.hue);
              applyAccent(p.hue);
              commit(p.hue);
            }}
          />
        ))}
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

/** A named accent: its colour as a dot and its name, filled cream while it is the one in use. */
function Swatch({ name, colour, on, testId, onPick }: { name: string; colour: string; on: boolean; testId: string; onPick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onPick}
      data-testid={testId}
      className={`inline-flex h-11 items-center gap-2 rounded-full border pl-2.5 pr-4 text-sm font-medium transition-colors ${on ? 'border-fg bg-fg text-bg' : 'border-fg/20 text-fg active:bg-fg/10'}`}
    >
      <span aria-hidden="true" className="h-5 w-5 rounded-full border border-black/20" style={{ background: colour }} />
      {name}
    </button>
  );
}
