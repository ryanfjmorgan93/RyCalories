import { describe, expect, it } from 'vitest';
import type { LiftStanding } from './liftStandards';
import { STRENGTH_STANDARDS, strengthStanding } from './standards';

const man = (standard: 'squat' | 'bench' | 'deadlift', e1rmKg: number, meet?: LiftStanding) =>
  strengthStanding({ standard, sex: 'male', e1rmKg, bodyweightKg: 80, meet })!;

// Men 24–34, 83 kg class, bench: the average (median) competition powerlifter 130 kg, the top 1% 195 kg.
const meet = (beatsPct: number): LiftStanding => ({ band: '24-34', weightClass: '83', n: 33938, medianKg: 130, eliteKg: 195, beatsPct });

describe('the training-status bands (Santos Junior et al. 2021)', () => {
  it('only the lifts with published bands can be chosen', () => {
    expect(STRENGTH_STANDARDS).toEqual(['squat', 'bench', 'deadlift']);
    expect(strengthStanding({ standard: 'press', sex: 'male', e1rmKg: 60, bodyweightKg: 80 })).toBeNull();
    expect(strengthStanding({ standard: 'squat', sex: 'male', e1rmKg: 100, bodyweightKg: 0 })).toBeNull();
  });

  it('names the level and the weight that reaches the next one', () => {
    // 115 / 80 = 143% of bodyweight: advanced (120–150); highly advanced is over 150, 151% = 120.8 → 121 kg.
    expect(man('squat', 115)).toEqual({ level: 'Advanced', head: 'e1RM 115 kg, 1.43 × bodyweight', next: 'Next: Highly advanced at 121 kg' });
    expect(man('squat', 60)).toMatchObject({ level: 'Beginner', next: 'Next: Intermediate at 64 kg' });
    expect(man('deadlift', 100)).toMatchObject({ level: 'Intermediate', next: 'Next: Advanced at 120 kg' });
  });

  it('rounds down, so a level is never flattered', () => {
    // Exactly 120% is still advanced on the bench: highly advanced is over 120.
    expect(man('bench', 96).level).toBe('Advanced');
    expect(man('bench', 96.5).level).toBe('Advanced'); // 120.6% is 120
    expect(man('bench', 97).level).toBe('Highly advanced');
    // The e1RM counts to the half kilo below: 63.9 is 63.5, 79% — not intermediate.
    expect(man('squat', 63.9)).toMatchObject({ level: 'Beginner', head: 'e1RM 63.5 kg, 0.79 × bodyweight' });
  });

  it('has lower lines for women', () => {
    const woman = strengthStanding({ standard: 'bench', sex: 'female', e1rmKg: 50, bodyweightKg: 60 })!;
    // 83%: over 80, highly advanced for a woman; a man at 83% is intermediate.
    expect(woman.level).toBe('Highly advanced');
    expect(strengthStanding({ standard: 'bench', sex: 'male', e1rmKg: 50, bodyweightKg: 60 })!.level).toBe('Intermediate');
  });
});

describe('above highly advanced: real competition powerlifters of the same sex, age and class', () => {
  it('points at the average competition powerlifter next', () => {
    expect(man('bench', 100, meet(10))).toMatchObject({
      level: 'Highly advanced',
      next: 'Next: the average competition powerlifter (men 24–34, 83 kg) at 130 kg',
    });
  });

  it('then says how many it beats, and the top 1% line', () => {
    // Level with the top 1% line is not above it.
    expect(man('bench', 195, meet(99)).next).toBe('Stronger than 99% of competition powerlifters (men 24–34, 83 kg). Top 1%: 195 kg');
    expect(man('bench', 140, meet(62)).next).toBe('Stronger than 62% of competition powerlifters (men 24–34, 83 kg). Top 1%: 195 kg');
    expect(man('bench', 195.5, meet(99)).next).toBe('Top 1% of competition powerlifters (men 24–34, 83 kg)');
  });

  it('stops at highly advanced with no year of birth', () => {
    expect(man('bench', 100)).toMatchObject({ level: 'Highly advanced', next: null });
  });
});
