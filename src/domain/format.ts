import type { Decision } from './engine';
import type { ExerciseKind, RoutineExercise } from './types';

const nf = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 });

export function fmtNum(n: number): string {
  return nf.format(Math.round(n * 100) / 100);
}

export function fmtKg(n: number): string {
  return `${fmtNum(n)} kg`;
}

/** Weight label aware of exercise kind: bodyweight_plus shows "+5 kg" / "bodyweight". */
export function fmtWeight(kind: ExerciseKind, n: number): string {
  if (kind === 'bodyweight_plus') return n === 0 ? 'bodyweight' : `+${fmtNum(n)} kg`;
  return fmtKg(n);
}

export function fmtRange(min: number, max: number, unit = ''): string {
  const u = unit ? ` ${unit}` : '';
  return min === max ? `${fmtNum(min)}${u}` : `${fmtNum(min)}–${fmtNum(max)}${u}`;
}

export function fmtReps(reps: number[]): string {
  return reps.join('/');
}

export function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  return `${m}:${String(r).padStart(2, '0')}`;
}

export function fmtMinutes(sec: number): string {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

export function fmtDate(iso: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-GB', opts).format(d);
}

export function fmtDateTime(iso: string): string {
  return fmtDate(iso, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function fmtDateLong(iso: string): string {
  return fmtDate(iso, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

/** "4 × 6–8 @ 110 kg" · "3 × 6–8 · calibrating" · "3 walks · 30–40 m". */
export function targetLine(rx: RoutineExercise, kind: ExerciseKind): string {
  const sets = rx.targetSetsMax && rx.targetSetsMax > rx.targetSets ? `${rx.targetSets}–${rx.targetSetsMax}` : `${rx.targetSets}`;
  if (kind === 'carry') {
    const dist =
      rx.distanceMinM !== undefined && rx.distanceMaxM !== undefined
        ? ` · ${fmtRange(rx.distanceMinM, rx.distanceMaxM, 'm')}`
        : '';
    const w = rx.mode === 'calibrating' ? ' · calibrating' : rx.currentWeight ? ` @ ${fmtKg(rx.currentWeight)}` : '';
    return `${sets} walks${dist}${w}`;
  }
  if (kind === 'timed') {
    const t = rx.mode === 'calibrating' ? 'calibrating' : `${fmtRange(rx.repMin, rx.repMax, 's')}`;
    return `${sets} × ${t}`;
  }
  const reps = fmtRange(rx.repMin, rx.repMax);
  if (rx.mode === 'calibrating') return `${sets} × ${reps} · calibrating`;
  return `${sets} × ${reps} @ ${fmtWeight(kind, rx.currentWeight)}`;
}

/** One-line plain-terms decision, e.g. "8/8/8/8 at 110 kg → 115 kg next time". */
export function decisionLine(d: Decision, kind: ExerciseKind): string {
  const at = d.sessionWeight ?? d.fromWeight;
  const reps = d.workingReps.length ? fmtReps(d.workingReps) : 'no working sets';
  const w = (n: number) => fmtWeight(kind, n);
  // When the session was lifted at a different weight than prescribed, say so every time.
  const was = d.sessionWeight !== null && d.sessionWeight !== d.fromWeight ? ` (was ${w(d.fromWeight)})` : '';
  switch (d.rule) {
    case 'increase':
      return `${reps} at ${w(at)} → ${w(d.toWeight)} next time${was}`;
    case 'hold':
      return `${reps} at ${w(at)} → hold ${w(d.toWeight)}${was}`;
    case 'hold_missing_sets':
      return `${d.workingSets}/${d.targetSets} sets (${reps}) at ${w(at)} → hold ${w(d.toWeight)}${was}`;
    case 'calibrating':
      return 'calibrating — no decision';
    case 'not_applicable':
      return 'no weight decision for this exercise';
    case 'lock_in':
      return `locked in at ${w(d.toWeight)}`;
  }
}

// ---------------------------------------------------------------------------
// Nutrition

export function fmtKcal(n: number): string {
  return `${Math.round(n)} kcal`;
}

/** Macro grams, one decimal at most: 24 g, 5.4 g. */
export function fmtGrams(n: number): string {
  return `${fmtNum(Math.round(n * 10) / 10)} g`;
}

/** A YYYY-MM-DD day key as a heading: "Today", "Yesterday", or "Sat 7 Mar". */
export function fmtDayKey(key: string, today: string, yesterday: string): string {
  if (key === today) return 'Today';
  if (key === yesterday) return 'Yesterday';
  const d = new Date(`${key}T00:00:00`);
  if (Number.isNaN(d.getTime())) return key;
  const sameYear = d.getFullYear() === new Date(`${today}T00:00:00`).getFullYear();
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(d);
}

/** Time of day from an ISO timestamp: "08:14". */
export function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(d);
}
