import { describe, expect, it } from 'vitest';
import { buildCheckIn, fmtDelta, type CheckInInput, type CheckInLift } from './checkin';
import type { Bodyweight } from './types';

const rdl: CheckInLift = {
  name: 'Romanian Deadlift (Barbell)',
  weight: 115,
  mode: 'normal',
  kind: 'reps',
  repMin: 6,
  repMax: 8,
  targetSets: 4,
  lastSessionReps: [8, 8, 8, 8],
};
const squat: CheckInLift = { name: 'Barbell Back Squat', weight: null, mode: 'calibrating', kind: 'reps', repMin: 5, repMax: 8, targetSets: 3 };
const bench: CheckInLift = { name: 'Bench Press (Barbell)', weight: 80, mode: 'normal', kind: 'reps', repMin: 6, repMax: 8, targetSets: 4 };

const bw = (date: string, kg: number): Bodyweight => ({ id: date, date, kg });

const base: CheckInInput = {
  asOf: '2026-09-08',
  days: 14,
  lifts: [rdl, squat],
  bodyweights: [bw('2026-08-20', 73.0), bw('2026-08-27', 74.0), bw('2026-08-30', 74.2), bw('2026-09-02', 74.3), bw('2026-09-05', 74.4), bw('2026-09-08', 74.6)],
  niggles: [{ date: '2026-08-31', tag: 'lower back', severity: 2, note: 'tight after RDL' }],
  sessions: [
    { date: '2026-08-26', title: 'Lower (Hinge)' },
    { date: '2026-08-28', title: 'Upper (Push)' },
    { date: '2026-08-30', title: 'Lower (Squat)' },
    { date: '2026-09-01', title: 'Upper (Pull)' },
    { date: '2026-09-03', title: 'Lower (Hinge)' },
    { date: '2026-09-05', title: 'Upper (Push)' },
  ],
};

describe('buildCheckIn', () => {
  it('renders the full text with two lifts', () => {
    const { text } = buildCheckIn(base);
    expect(text).toBe(
      [
        'Check-in – 8 Sep 2026 (last 14 days)',
        'Lifts',
        '- Romanian Deadlift (Barbell): 115 kg · 4 × 6–8 · last 8/8/8/8',
        '- Barbell Back Squat: calibrating',
        'Bodyweight',
        '- 74 → 74.6 kg (+0.6), avg 74.3 over 5 readings',
        'Sessions: 6 (Lower (Hinge) ×2, Upper (Push) ×2, Lower (Squat) ×1, Upper (Pull) ×1)',
        'Niggles',
        '- 31 Aug: lower back (2) – tight after RDL',
      ].join('\n'),
    );
  });

  it('shows a calibrating lift as calibrating even with a stored weight', () => {
    const { text } = buildCheckIn({ ...base, lifts: [{ ...squat, weight: 60 }] });
    expect(text).toContain('- Barbell Back Squat: calibrating');
    expect(text).not.toContain('60 kg');
  });

  it('shows a null weight as calibrating and omits last reps when absent', () => {
    const { text } = buildCheckIn({ ...base, lifts: [{ ...bench, weight: null }, bench] });
    expect(text).toContain('- Bench Press (Barbell): calibrating');
    expect(text).toContain('- Bench Press (Barbell): 80 kg · 4 × 6–8');
    expect(text).not.toContain('80 kg · 4 × 6–8 · last');
  });

  it('formats bodyweight_plus weights with a plus', () => {
    const { text } = buildCheckIn({
      ...base,
      lifts: [{ name: 'Back Extension', weight: 5, mode: 'normal', kind: 'bodyweight_plus', repMin: 10, repMax: 15, targetSets: 3 }],
    });
    expect(text).toContain('- Back Extension: +5 kg · 3 × 10–15');
  });

  it('handles empty bodyweights', () => {
    const out = buildCheckIn({ ...base, bodyweights: [] });
    expect(out.bodyweight).toEqual({ first: null, last: null, avg: null, delta: null, readings: 0 });
    expect(out.text).toContain('Bodyweight\n- none');
  });

  it('ignores bodyweights outside the window', () => {
    const out = buildCheckIn({ ...base, bodyweights: [bw('2026-08-01', 70), bw('2026-09-09', 90), bw('2026-09-01', 74)] });
    expect(out.bodyweight).toEqual({ first: 74, last: 74, avg: 74, delta: 0, readings: 1 });
    expect(out.text).toContain('- 74 → 74 kg (0), avg 74 over 1 reading');
  });

  it('prints "- none" when there are no niggles', () => {
    const { text } = buildCheckIn({ ...base, niggles: [] });
    expect(text).toContain('Niggles\n- none');
    expect(text.endsWith('Niggles\n- none')).toBe(true);
  });

  it('omits the niggle note when absent and drops niggles outside the window', () => {
    const { text } = buildCheckIn({
      ...base,
      niggles: [
        { date: '2026-09-02', tag: 'knee', severity: 1 },
        { date: '2026-08-10', tag: 'shoulder', severity: 3 },
      ],
    });
    expect(text).toContain('Niggles\n- 2 Sep: knee (1)');
    expect(text).not.toContain('shoulder');
  });

  it('filters sessions to the window by asOf and days', () => {
    const sessions = [
      { date: '2026-08-25', title: 'Before' },
      { date: '2026-08-26', title: 'First day' },
      { date: '2026-09-08', title: 'Last day' },
      { date: '2026-09-09', title: 'After' },
    ];
    const { text } = buildCheckIn({ ...base, sessions });
    expect(text).toContain('Sessions: 2 (First day ×1, Last day ×1)');
    expect(text).not.toContain('Before');
    expect(text).not.toContain('After');

    const week = buildCheckIn({ ...base, sessions, days: 7 });
    expect(week.text).toContain('Check-in – 8 Sep 2026 (last 7 days)');
    expect(week.text).toContain('Sessions: 1 (Last day ×1)');
  });

  it('prints no breakdown when there are no sessions', () => {
    const { text } = buildCheckIn({ ...base, sessions: [] });
    expect(text).toContain('\nSessions: 0\n');
  });

  it('signs the bodyweight delta', () => {
    const up = buildCheckIn({ ...base, bodyweights: [bw('2026-08-27', 74), bw('2026-09-08', 74.6)] });
    expect(up.bodyweight.delta).toBe(0.6);
    expect(up.text).toContain('74 → 74.6 kg (+0.6)');

    const down = buildCheckIn({ ...base, bodyweights: [bw('2026-08-27', 75), bw('2026-09-08', 74.6)] });
    expect(down.bodyweight.delta).toBe(-0.4);
    expect(down.text).toContain('75 → 74.6 kg (-0.4)');

    expect(fmtDelta(0.25)).toBe('+0.3');
    expect(fmtDelta(-1)).toBe('-1');
    expect(fmtDelta(0)).toBe('0');
  });

  it('exposes the window start and session counts', () => {
    const out = buildCheckIn(base);
    expect(out.from).toBe('2026-08-26');
    expect(out.sessionCounts[0]).toEqual({ title: 'Lower (Hinge)', count: 2 });
  });
});
