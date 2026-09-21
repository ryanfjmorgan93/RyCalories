import { describe, expect, it } from 'vitest';
import type { SessionOutcome, Suggestion } from './engine';
import { deloadLoad, prescribe, type PrescriptionInput } from './prescription';

const settings: PrescriptionInput['settings'] = { barKg: 20, plates: [25, 20, 15, 10, 5, 2.5, 1.25], deloadPercent: 0.9 };

const repsRx: PrescriptionInput['rx'] = {
  targetSets: 4,
  repMin: 6,
  repMax: 8,
  currentWeight: 110,
  increment: 5,
  mode: 'normal',
};

describe('prescribe — reps', () => {
  it('a normal reps prescription', () => {
    const p = prescribe({ rx: repsRx, kind: 'reps', settings });
    expect(p).toEqual({
      weight: 110,
      sets: 4,
      repMin: 6,
      repMax: 8,
      line: '110 kg × 6–8 × 4',
      reason: '',
      weightDelta: null,
      flags: [],
    });
  });

  it('shows a set range when targetSetsMax exceeds targetSets', () => {
    const rx = { ...repsRx, targetSets: 3, targetSetsMax: 4 };
    const p = prescribe({ rx, kind: 'reps', settings });
    expect(p.line).toBe('110 kg × 6–8 × 3–4');
    expect(p.sets).toBe(3);
  });

  it('a targetSetsMax equal to targetSets is not shown as a range', () => {
    const rx = { ...repsRx, targetSets: 4, targetSetsMax: 4 };
    expect(prescribe({ rx, kind: 'reps', settings }).line).toBe('110 kg × 6–8 × 4');
  });

  it('calibrating hides the weight and flags it', () => {
    const rx = { ...repsRx, mode: 'calibrating' as const, currentWeight: 0 };
    const p = prescribe({ rx, kind: 'reps', settings });
    expect(p.weight).toBeNull();
    expect(p.line).toBe('calibrating · 6–8 × 4');
    expect(p.flags).toEqual(['calibrating']);
  });
});

describe('prescribe — bodyweight_plus', () => {
  const rx: PrescriptionInput['rx'] = { targetSets: 3, repMin: 10, repMax: 15, currentWeight: 5, increment: 5, mode: 'normal' };

  it('shows the fmtWeight "+N kg" style', () => {
    const p = prescribe({ rx, kind: 'bodyweight_plus', settings });
    expect(p.weight).toBe(5);
    expect(p.line).toBe('+5 kg × 10–15 × 3');
  });

  it('shows "bodyweight" at 0', () => {
    const p = prescribe({ rx: { ...rx, currentWeight: 0 }, kind: 'bodyweight_plus', settings });
    expect(p.weight).toBe(0);
    expect(p.line).toBe('bodyweight × 10–15 × 3');
  });
});

describe('prescribe — carry', () => {
  const rx: PrescriptionInput['rx'] = {
    targetSets: 3,
    targetSetsMax: 4,
    repMin: 1,
    repMax: 1,
    currentWeight: 56,
    increment: 2,
    mode: 'normal',
    distanceMinM: 30,
    distanceMaxM: 40,
  };

  it('is never a weight exercise — weight is always null', () => {
    const p = prescribe({ rx, kind: 'carry', settings });
    expect(p.weight).toBeNull();
    expect(p.line).toBe('30–40 m × 3–4');
  });

  it('calibrating carry', () => {
    const p = prescribe({ rx: { ...rx, mode: 'calibrating' }, kind: 'carry', settings });
    expect(p.weight).toBeNull();
    expect(p.line).toBe('calibrating · 30–40 m × 3–4');
    expect(p.flags).toEqual(['calibrating']);
  });
});

describe('prescribe — timed', () => {
  const rx: PrescriptionInput['rx'] = { targetSets: 3, repMin: 30, repMax: 45, currentWeight: 0, increment: 0, mode: 'normal' };

  it('is never a weight exercise — weight is always null', () => {
    const p = prescribe({ rx, kind: 'timed', settings });
    expect(p.weight).toBeNull();
    expect(p.line).toBe('30–45 s × 3');
  });

  it('calibrating timed', () => {
    const p = prescribe({ rx: { ...rx, mode: 'calibrating' }, kind: 'timed', settings });
    expect(p.line).toBe('calibrating · 30–45 s × 3');
  });
});

describe('prescribe — deload', () => {
  // 100 kg current, 90% deload, 5 kg increment grid → 90 kg exactly (§ deloadLoad tests below).
  const deloadRx: PrescriptionInput['rx'] = { ...repsRx, targetSets: 3, currentWeight: 100 };

  it('the load is deloadLoad(...) and the line names it, with no plates when equipment is not barbell', () => {
    const p = prescribe({ rx: deloadRx, kind: 'reps', deload: true, settings });
    expect(p.weight).toBe(90);
    expect(p.line).toBe('90 kg × 6–8 × 3 · deload');
    expect(p.flags).toEqual(['deload']);
  });

  it('snaps down to plates for a barbell exercise', () => {
    const p = prescribe({
      rx: deloadRx,
      kind: 'reps',
      equipment: 'barbell',
      deload: true,
      settings: { barKg: 20, plates: [20, 10], deloadPercent: 0.9 },
    });
    expect(p.weight).toBe(80);
    expect(p.line).toBe('80 kg × 6–8 × 3 · deload');
  });

  it('does not snap to plates for a non-barbell exercise even when plates are configured', () => {
    const p = prescribe({
      rx: deloadRx,
      kind: 'reps',
      equipment: 'dumbbell',
      deload: true,
      settings: { barKg: 20, plates: [20, 10], deloadPercent: 0.9 },
    });
    expect(p.weight).toBe(90);
  });

  it('calibrating still hides the weight, but the deload flag and suffix still show', () => {
    const rx = { ...repsRx, mode: 'calibrating' as const, currentWeight: 0 };
    const p = prescribe({ rx, kind: 'reps', deload: true, settings });
    expect(p.weight).toBeNull();
    expect(p.line).toBe('calibrating · 6–8 × 4 · deload');
    expect(p.flags).toEqual(['calibrating', 'deload']);
  });

  it('falls back to defaults when settings are absent', () => {
    const p = prescribe({ rx: deloadRx, kind: 'reps', deload: true, settings: {} });
    expect(p.weight).toBe(90);
  });
});

describe('prescribe — reason from lastOutcome', () => {
  const base = { rx: repsRx, kind: 'reps' as const, settings };

  it('increase → "up N kg last time"', () => {
    const lastOutcome: SessionOutcome = { fromWeight: 100, appliedWeight: 105, rule: 'increase' };
    expect(prescribe({ ...base, lastOutcome }).reason).toBe('up 5 kg last time');
  });

  it('a fractional increase keeps 2.5-kg steps clean', () => {
    const lastOutcome: SessionOutcome = { fromWeight: 100, appliedWeight: 102.5, rule: 'increase' };
    expect(prescribe({ ...base, lastOutcome }).reason).toBe('up 2.5 kg last time');
  });

  it('hold → "held last time"', () => {
    const lastOutcome: SessionOutcome = { fromWeight: 100, appliedWeight: 100, rule: 'hold' };
    expect(prescribe({ ...base, lastOutcome }).reason).toBe('held last time');
  });

  it('hold_missing_sets → "held: missed sets last time"', () => {
    const lastOutcome: SessionOutcome = { fromWeight: 100, appliedWeight: 100, rule: 'hold_missing_sets' };
    expect(prescribe({ ...base, lastOutcome }).reason).toBe('held: missed sets last time');
  });

  it('deload → "deload last time"', () => {
    const lastOutcome: SessionOutcome = { fromWeight: 100, appliedWeight: 100, rule: 'deload' };
    expect(prescribe({ ...base, lastOutcome }).reason).toBe('deload last time');
  });

  it('lock_in → "locked in last time"', () => {
    const lastOutcome: SessionOutcome = { fromWeight: 0, appliedWeight: 80, rule: 'lock_in' };
    expect(prescribe({ ...base, lastOutcome }).reason).toBe('locked in last time');
  });

  it('calibrating and not_applicable outcomes give no reason', () => {
    const cal: SessionOutcome = { fromWeight: 0, appliedWeight: 0, rule: 'calibrating' };
    const na: SessionOutcome = { fromWeight: 56, appliedWeight: 56, rule: 'not_applicable' };
    expect(prescribe({ ...base, lastOutcome: cal }).reason).toBe('');
    expect(prescribe({ ...base, lastOutcome: na }).reason).toBe('');
  });

  it('no lastOutcome gives no reason', () => {
    expect(prescribe({ ...base }).reason).toBe('');
    expect(prescribe({ ...base, lastOutcome: null }).reason).toBe('');
  });
});

describe('prescribe — weightDelta from lastOutcome (the numeric counterpart of reason)', () => {
  const base = { rx: repsRx, kind: 'reps' as const, settings };

  it('increase → positive kg, matching the number in reason', () => {
    const lastOutcome: SessionOutcome = { fromWeight: 100, appliedWeight: 105, rule: 'increase' };
    expect(prescribe({ ...base, lastOutcome }).weightDelta).toBe(5);
  });

  it('a fractional increase stays a clean 2.5-kg step', () => {
    const lastOutcome: SessionOutcome = { fromWeight: 100, appliedWeight: 102.5, rule: 'increase' };
    expect(prescribe({ ...base, lastOutcome }).weightDelta).toBe(2.5);
  });

  it('deload → negative kg — the drop the deload session itself would have shown, even though the stored fromWeight/appliedWeight do not move', () => {
    // 100 kg current, 90% deload, 5 kg increment grid → 90 kg (matches the "prescribe — deload" tests above).
    const lastOutcome: SessionOutcome = { fromWeight: 100, appliedWeight: 100, rule: 'deload' };
    expect(prescribe({ ...base, lastOutcome }).weightDelta).toBe(-10);
  });

  it('deload snaps to plates for a barbell exercise, same as the deload prescription itself', () => {
    const lastOutcome: SessionOutcome = { fromWeight: 100, appliedWeight: 100, rule: 'deload' };
    const p = prescribe({
      ...base,
      equipment: 'barbell',
      lastOutcome,
      settings: { barKg: 20, plates: [20, 10], deloadPercent: 0.9 },
    });
    // deloadLoad(100, 0.9, 5, {barKg:20, plates:[20,10]}) = 80 (see the deloadLoad tests below).
    expect(p.weightDelta).toBe(-20);
  });

  it('an unchanged hold, calibrating or not_applicable outcome gives no weightDelta', () => {
    const rules: SessionOutcome['rule'][] = ['hold', 'hold_missing_sets', 'calibrating', 'not_applicable'];
    for (const rule of rules) {
      const lastOutcome: SessionOutcome = { fromWeight: 100, appliedWeight: 100, rule };
      expect(prescribe({ ...base, lastOutcome }).weightDelta, rule).toBeNull();
    }
  });

  // §4.1: a hold "re-prescribes the deviated weight visibly rather than snapping back silently"
  // (see `decide` in engine.ts) — so a hold whose stored weight actually moved must show it too,
  // not just an 'increase'. This is read generically as appliedWeight − fromWeight, not by
  // special-casing the 'increase' rule, precisely so a deviated hold like this one is not missed.
  it('a deviated hold that came in under prescription shows the drop, in the same negative direction as a deload — never hidden', () => {
    const lastOutcome: SessionOutcome = { fromWeight: 105, appliedWeight: 100, rule: 'hold' };
    expect(prescribe({ ...base, lastOutcome }).weightDelta).toBe(-5);
  });

  it('a deviated hold_missing_sets that came in over prescription shows the rise', () => {
    const lastOutcome: SessionOutcome = { fromWeight: 100, appliedWeight: 102.5, rule: 'hold_missing_sets' };
    expect(prescribe({ ...base, lastOutcome }).weightDelta).toBe(2.5);
  });

  it('lock_in shows the locked-in starting weight as a rise', () => {
    const lastOutcome: SessionOutcome = { fromWeight: 0, appliedWeight: 80, rule: 'lock_in' };
    expect(prescribe({ ...base, lastOutcome }).weightDelta).toBe(80);
  });

  it('no lastOutcome gives no weightDelta', () => {
    expect(prescribe({ ...base }).weightDelta).toBeNull();
    expect(prescribe({ ...base, lastOutcome: null }).weightDelta).toBeNull();
  });

  // A deload prescribed for TODAY sits right next to this chip's own line, so it must win over
  // whatever happened last time — otherwise a green "+5 kg" would sit beside a line that itself
  // reads as a deload drop.
  it("today's own deload wins over an increase from last time: shows today's drop, not last time's rise", () => {
    const lastOutcome: SessionOutcome = { fromWeight: 95, appliedWeight: 100, rule: 'increase' };
    const rx = { ...repsRx, currentWeight: 100 };
    const p = prescribe({ rx, kind: 'reps', deload: true, lastOutcome, settings });
    // deloadLoad(100, 0.9, 5) = 90 (grid math shared with the "prescribe — deload" tests above).
    expect(p.weight).toBe(90);
    expect(p.weightDelta).toBe(-10);
  });

  it("today's deload still wins even when last time was itself a deload (no double-counting the two drops)", () => {
    const lastOutcome: SessionOutcome = { fromWeight: 100, appliedWeight: 100, rule: 'deload' };
    const rx = { ...repsRx, currentWeight: 100 };
    const p = prescribe({ rx, kind: 'reps', deload: true, lastOutcome, settings });
    expect(p.weightDelta).toBe(-10);
  });
});

describe('prescribe — flags from stall', () => {
  const base = { rx: repsRx, kind: 'reps' as const, settings };

  it('stalled', () => {
    const stall: Suggestion = { kind: 'stalled', sessions: 3, weight: 110 };
    expect(prescribe({ ...base, stall }).flags).toEqual(['stalled']);
  });

  it('regression', () => {
    const stall: Suggestion = { kind: 'regression', holdWeight: 110, dropWeight: 105, setsBelowMin: 2 };
    expect(prescribe({ ...base, stall }).flags).toEqual(['regression']);
  });

  it('a double_increment suggestion carries no flag', () => {
    const stall: Suggestion = { kind: 'double_increment', toWeight: 120, minRir: 3 };
    expect(prescribe({ ...base, stall }).flags).toEqual([]);
  });

  it('every flag combines in calibrating, stalled, deload, regression order', () => {
    const rx = { ...repsRx, mode: 'calibrating' as const, currentWeight: 0 };
    const stall: Suggestion = { kind: 'regression', holdWeight: 110, dropWeight: 105, setsBelowMin: 2 };
    const p = prescribe({ rx, kind: 'reps', deload: true, stall, settings });
    expect(p.flags).toEqual(['calibrating', 'deload', 'regression']);
  });
});

describe('deloadLoad', () => {
  it('100 kg at 90% with a 5 kg increment lands exactly on the grid', () => {
    expect(deloadLoad(100, 0.9, 5)).toBe(90);
  });

  it('floors to the grid rather than rounding to it', () => {
    // 102.5 × 0.9 = 92.25 → the 2.5-kg grid below it is 90, not a rounded-up 92.5.
    expect(deloadLoad(102.5, 0.9, 2.5)).toBe(90);
  });

  it('snaps down further when the plates on hand cannot make the grid load', () => {
    // 100 × 0.9 = 90 on the increment grid, but 20+10 kg plates over a 20 kg bar can only reach 80.
    expect(deloadLoad(100, 0.9, 5, { barKg: 20, plates: [20, 10] })).toBe(80);
  });

  it('never goes below zero', () => {
    expect(deloadLoad(0, 0.9, 5)).toBe(0);
    expect(deloadLoad(1, 0.9, 5)).toBe(0);
  });

  it('keeps kg arithmetic free of float noise', () => {
    expect(deloadLoad(110, 0.9, 2.5)).toBe(97.5);
  });
});

describe('seed data (WP2-c fields)', () => {
  it('every seed exercise has an equipment kind', async () => {
    const { SEED_EXERCISES } = await import('@/db/seed');
    for (const ex of SEED_EXERCISES) {
      expect(ex.equipment, `${ex.name} is missing equipment`).toBeDefined();
    }
  });

  it('26 seed exercises have a demo slug that resolves through findDemo', async () => {
    const { SEED_EXERCISES } = await import('@/db/seed');
    const { findDemo } = await import('@/data/exerciseDemos');
    const withDemo = SEED_EXERCISES.filter((ex) => ex.demo !== undefined);
    expect(withDemo).toHaveLength(26);
    for (const ex of withDemo) {
      expect(findDemo(ex.demo!), `${ex.name}'s demo slug "${ex.demo}" does not resolve`).toBeDefined();
    }
    const withoutDemo = SEED_EXERCISES.filter((ex) => ex.demo === undefined);
    expect(withoutDemo.map((ex) => ex.name)).toEqual(['Neck']);
  });

  it('exactly two seed exercises carry a strength standard', async () => {
    const { SEED_EXERCISES } = await import('@/db/seed');
    const withStandard = SEED_EXERCISES.filter((ex) => ex.standard !== undefined);
    expect(withStandard).toHaveLength(2);
    expect(withStandard.map((ex) => ({ name: ex.name, standard: ex.standard }))).toEqual(
      expect.arrayContaining([
        { name: 'Barbell Back Squat', standard: 'squat' },
        { name: 'Bench Press (Barbell)', standard: 'bench' },
      ]),
    );
  });
});
