import { useState } from 'react';
import type { MuscleGroup } from '@/domain/types';
import { Segmented } from './Chip';

export type BodyMapMode = 'sets' | 'recency';

export interface RegionIntensityInput {
  mode: BodyMapMode;
  /** Sets logged this week for the group. */
  sets: number;
  /** This group's own weekly target, when one is set. */
  target: number | null;
  /** Fallback denominator for 'sets' mode when the group has no target of its own: the busiest group's set count. */
  maxSets: number;
  /** Days since the group was last trained; undefined when it never has been. */
  daysAgo: number | undefined;
}

/**
 * Fill opacity (0–1) for one muscle group's region.
 *  - 'sets': this week's sets over its own target, or over the busiest group's count when it has
 *    no target — clamped to 1, zero when nothing has been logged.
 *  - 'recency': trained in the last 0–2 days reads strong, 3–6 medium, 7+ dim; never trained is 0.
 */
export function regionIntensity(input: RegionIntensityInput): number {
  if (input.mode === 'sets') {
    if (input.sets <= 0) return 0;
    const denom = input.target ?? input.maxSets;
    if (!denom || denom <= 0) return 0;
    return Math.max(0, Math.min(1, input.sets / denom));
  }
  if (input.daysAgo === undefined) return 0;
  if (input.daysAgo <= 2) return 1;
  if (input.daysAgo <= 6) return 0.55;
  return 0.25;
}

// -- Small path-data helpers. Every shape below is plain geometry (an ellipse, a capsule between
// two points, a rounded rect) so the figures can be hand-placed by coordinate without tracing an
// image or hand-rolling bezier maths per limb. --

/** A full ellipse, as two arcs, closed. */
function ellipse(cx: number, cy: number, rx: number, ry: number): string {
  return `M${cx - rx},${cy} A${rx},${ry} 0 1,1 ${cx + rx},${cy} A${rx},${ry} 0 1,1 ${cx - rx},${cy} Z`;
}

/** A rounded rectangle. */
function roundRect(x: number, y: number, w: number, h: number, r: number): string {
  return `M${x + r},${y} H${x + w - r} A${r},${r} 0 0 1 ${x + w},${y + r} V${y + h - r} A${r},${r} 0 0 1 ${x + w - r},${y + h} H${x + r} A${r},${r} 0 0 1 ${x},${y + h - r} V${y + r} A${r},${r} 0 0 1 ${x + r},${y} Z`;
}

/** A rounded "stadium" between two points, as a single seamless outline (straight side, a round
 *  cap, straight side, a round cap) — what lets two capsules meeting at a joint (shoulder→elbow→
 *  wrist) read as a limb with a slight bend, without doubling the stroke at either end. */
function capsule(x1: number, y1: number, x2: number, y2: number, r: number): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const px = (-dy / len) * r;
  const py = (dx / len) * r;
  const p1x = x1 + px;
  const p1y = y1 + py;
  const p2x = x2 + px;
  const p2y = y2 + py;
  const p3x = x2 - px;
  const p3y = y2 - py;
  const p4x = x1 - px;
  const p4y = y1 - py;
  return `M${p1x},${p1y} L${p2x},${p2y} A${r},${r} 0 0 0 ${p3x},${p3y} L${p4x},${p4y} A${r},${r} 0 0 0 ${p1x},${p1y} Z`;
}

/** Torso outline: shoulders, tapering to the waist, flaring to the hips. Identical for both
 *  figures, just re-centred. */
function torso(cx: number): string {
  return (
    `M${cx - 56},82 C${cx - 58},110 ${cx - 40},128 ${cx - 34},150 C${cx - 30},168 ${cx - 44},178 ${cx - 46},192 ` +
    `L${cx - 12},206 L${cx + 12},206 L${cx + 46},192 C${cx + 44},178 ${cx + 30},168 ${cx + 34},150 ` +
    `C${cx + 40},128 ${cx + 58},110 ${cx + 56},82 C${cx + 30},70 ${cx - 30},70 ${cx - 56},82 Z`
  );
}

/** Non-interactive base silhouette for one figure: head, neck, torso, arms (with a bend at the
 *  elbow), legs, hands and feet. */
function silhouette(cx: number): string {
  return [
    ellipse(cx, 36, 17, 21),
    roundRect(cx - 10, 56, 20, 20, 6),
    torso(cx),
    capsule(cx - 58, 84, cx - 75, 170, 15),
    capsule(cx - 75, 170, cx - 66, 248, 11),
    capsule(cx + 58, 84, cx + 75, 170, 15),
    capsule(cx + 75, 170, cx + 66, 248, 11),
    ellipse(cx - 64, 264, 9, 15),
    ellipse(cx + 64, 264, 9, 15),
    capsule(cx - 27, 204, cx - 30, 298, 19),
    capsule(cx + 27, 204, cx + 30, 298, 19),
    capsule(cx - 30, 298, cx - 27, 385, 13),
    capsule(cx + 30, 298, cx + 27, 385, 13),
    ellipse(cx - 26, 401, 13, 9),
    ellipse(cx + 26, 401, 13, 9),
  ].join(' ');
}

interface Region {
  group: MuscleGroup;
  d: string;
}

// Figure centrelines: front figure on the left, back figure on the right, ~170 wide each.
const FX = 100;
const BX = 300;

const FRONT_REGIONS: Region[] = [
  { group: 'neck', d: ellipse(FX, 66, 8, 10) },
  { group: 'shoulders', d: `${ellipse(FX - 58, 88, 16, 18)} ${ellipse(FX + 58, 88, 16, 18)}` },
  { group: 'chest', d: `${ellipse(FX - 25, 104, 21, 16)} ${ellipse(FX + 25, 104, 21, 16)}` },
  { group: 'biceps', d: `${capsule(FX - 58, 86, FX - 74, 168, 12)} ${capsule(FX + 58, 86, FX + 74, 168, 12)}` },
  { group: 'forearms', d: `${capsule(FX - 74, 170, FX - 66, 246, 9)} ${capsule(FX + 74, 170, FX + 66, 246, 9)}` },
  { group: 'abs', d: roundRect(FX - 21, 126, 42, 66, 8) },
  { group: 'quads', d: `${capsule(FX - 27, 206, FX - 30, 296, 16)} ${capsule(FX + 27, 206, FX + 30, 296, 16)}` },
  { group: 'adductors', d: capsule(FX, 208, FX, 288, 8) },
  { group: 'calves', d: `${capsule(FX - 30, 300, FX - 27, 383, 8)} ${capsule(FX + 30, 300, FX + 27, 383, 8)}` },
];

const BACK_REGIONS: Region[] = [
  { group: 'neck', d: ellipse(BX, 66, 8, 10) },
  { group: 'traps', d: `M${BX},70 L${BX - 40},98 L${BX - 15},132 L${BX},144 L${BX + 15},132 L${BX + 40},98 Z` },
  { group: 'rear delts', d: `${ellipse(BX - 58, 88, 16, 18)} ${ellipse(BX + 58, 88, 16, 18)}` },
  { group: 'upper back', d: roundRect(BX - 15, 130, 30, 42, 8) },
  { group: 'lats', d: `${capsule(BX - 50, 106, BX - 35, 176, 17)} ${capsule(BX + 50, 106, BX + 35, 176, 17)}` },
  { group: 'triceps', d: `${capsule(BX - 58, 86, BX - 74, 168, 12)} ${capsule(BX + 58, 86, BX + 74, 168, 12)}` },
  { group: 'lower back', d: roundRect(BX - 19, 172, 38, 30, 10) },
  { group: 'glutes', d: `${ellipse(BX - 23, 202, 20, 18)} ${ellipse(BX + 23, 202, 20, 18)}` },
  { group: 'hamstrings', d: `${capsule(BX - 27, 206, BX - 30, 296, 16)} ${capsule(BX + 27, 206, BX + 30, 296, 16)}` },
  { group: 'calves', d: `${capsule(BX - 30, 300, BX - 27, 383, 11)} ${capsule(BX + 30, 300, BX + 27, 383, 11)}` },
];

const BASE_FRONT_D = silhouette(FX);
const BASE_BACK_D = silhouette(BX);

function readout(mode: BodyMapMode, group: MuscleGroup, sets: number, daysAgo: number | undefined): string {
  if (mode === 'sets') return `${group} · ${sets} ${sets === 1 ? 'set' : 'sets'} this week`;
  if (daysAgo === undefined) return `${group} · not yet trained`;
  if (daysAgo === 0) return `${group} · today`;
  if (daysAgo === 1) return `${group} · 1 day ago`;
  return `${group} · ${daysAgo} days ago`;
}

export function BodyMap({
  setsByGroup,
  targetByGroup,
  recency,
}: {
  setsByGroup: Partial<Record<MuscleGroup, number>>;
  targetByGroup: Partial<Record<MuscleGroup, number>>;
  recency: Partial<Record<MuscleGroup, number>>;
}) {
  const [mode, setMode] = useState<BodyMapMode>('sets');
  const [selected, setSelected] = useState<MuscleGroup | null>(null);

  const maxSets = Math.max(1, ...Object.values(setsByGroup).map((n) => n ?? 0));

  const intensityOf = (group: MuscleGroup): number =>
    regionIntensity({
      mode,
      sets: setsByGroup[group] ?? 0,
      target: targetByGroup[group] ?? null,
      maxSets,
      daysAgo: recency[group],
    });

  const region = (prefix: string) => (r: Region) => (
    <path
      key={`${prefix}-${r.group}`}
      data-muscle={r.group}
      d={r.d}
      fill="var(--c-accent)"
      fillOpacity={intensityOf(r.group)}
      stroke="var(--c-line)"
      strokeWidth={1.1}
      className="cursor-pointer"
      role="button"
      aria-label={r.group}
      tabIndex={0}
      onClick={() => setSelected(r.group)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') setSelected(r.group);
      }}
    />
  );

  return (
    <div>
      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { value: 'sets', label: 'Sets this week' },
          { value: 'recency', label: 'Last trained' },
        ]}
      />
      <svg viewBox="0 0 400 420" className="mt-3 block w-full" role="img" aria-label="Muscle map, front and back">
        {/* Base silhouettes, non-interactive. */}
        <path d={BASE_FRONT_D} fill="var(--c-surface-2)" stroke="var(--c-line)" strokeWidth={1.5} />
        <path d={BASE_BACK_D} fill="var(--c-surface-2)" stroke="var(--c-line)" strokeWidth={1.5} />

        {FRONT_REGIONS.map(region('front'))}
        {BACK_REGIONS.map(region('back'))}
      </svg>
      <div className="mt-2 text-center text-sm text-muted" data-testid="body-map-readout">
        {selected ? readout(mode, selected, setsByGroup[selected] ?? 0, recency[selected]) : 'Tap a muscle'}
      </div>
    </div>
  );
}
