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

function rect(x: number, y: number, w: number, h: number): string {
  return `M${x},${y} h${w} v${h} h${-w} Z`;
}

interface Region {
  group: MuscleGroup;
  d: string;
}

// Simple blocky silhouettes — not anatomy, just enough shape per group to tap.
const FRONT_REGIONS: Region[] = [
  { group: 'neck', d: rect(53, 34, 14, 9) },
  { group: 'shoulders', d: `${rect(27, 44, 12, 15)} ${rect(81, 44, 12, 15)}` },
  { group: 'chest', d: rect(38, 44, 44, 26) },
  { group: 'biceps', d: `${rect(22, 60, 12, 28)} ${rect(86, 60, 12, 28)}` },
  { group: 'forearms', d: `${rect(20, 89, 11, 26)} ${rect(89, 89, 11, 26)}` },
  { group: 'abs', d: rect(42, 71, 36, 30) },
  { group: 'quads', d: `${rect(40, 102, 17, 40)} ${rect(63, 102, 17, 40)}` },
  { group: 'adductors', d: rect(57, 102, 6, 40) },
  { group: 'calves', d: `${rect(41, 143, 15, 34)} ${rect(64, 143, 15, 34)}` },
];

const BACK_REGIONS: Region[] = [
  { group: 'neck', d: rect(193, 34, 14, 9) },
  { group: 'traps', d: rect(177, 44, 46, 14) },
  { group: 'rear delts', d: `${rect(165, 44, 12, 14)} ${rect(223, 44, 12, 14)}` },
  { group: 'upper back', d: rect(183, 58, 34, 20) },
  { group: 'lats', d: `${rect(171, 58, 12, 30)} ${rect(217, 58, 12, 30)}` },
  { group: 'triceps', d: `${rect(163, 60, 12, 56)} ${rect(225, 60, 12, 56)}` },
  { group: 'lower back', d: rect(187, 78, 26, 20) },
  { group: 'glutes', d: `${rect(183, 98, 15, 20)} ${rect(202, 98, 15, 20)}` },
  { group: 'hamstrings', d: `${rect(183, 118, 15, 28)} ${rect(202, 118, 15, 28)}` },
  { group: 'calves', d: `${rect(184, 146, 13, 32)} ${rect(203, 146, 13, 32)}` },
];

const ALL_FRONT_D = FRONT_REGIONS.map((r) => r.d).join(' ');
const ALL_BACK_D = BACK_REGIONS.map((r) => r.d).join(' ');

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
      strokeWidth={0.75}
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
      <svg viewBox="0 0 240 190" className="mt-3 block w-full" role="img" aria-label="Muscle map, front and back">
        {/* Base silhouettes, non-interactive. */}
        <circle cx={60} cy={22} r={13} fill="var(--c-surface-2)" stroke="var(--c-line)" strokeWidth={0.75} />
        <path d={ALL_FRONT_D} fill="var(--c-surface-2)" stroke="var(--c-line)" strokeWidth={0.75} />
        <circle cx={200} cy={22} r={13} fill="var(--c-surface-2)" stroke="var(--c-line)" strokeWidth={0.75} />
        <path d={ALL_BACK_D} fill="var(--c-surface-2)" stroke="var(--c-line)" strokeWidth={0.75} />

        {FRONT_REGIONS.map(region('front'))}
        {BACK_REGIONS.map(region('back'))}
      </svg>
      <div className="mt-2 text-center text-sm text-muted" data-testid="body-map-readout">
        {selected ? readout(mode, selected, setsByGroup[selected] ?? 0, recency[selected]) : 'Tap a muscle'}
      </div>
    </div>
  );
}
