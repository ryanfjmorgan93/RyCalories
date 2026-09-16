import { describe, expect, it } from 'vitest';
import { buildContextBlock, buildPrompt, buildSystemPrompt, trimReply, type AssistantContext, type AssistantTurn } from './assistant';

const minimalCtx: AssistantContext = { today: '2026-09-16' };

describe('buildSystemPrompt', () => {
  it('is deterministic and mentions the house rules', () => {
    const a = buildSystemPrompt();
    const b = buildSystemPrompt();
    expect(a).toBe(b);
    expect(a).toContain('kilograms');
    expect(a).toContain('British English');
    expect(a.toLowerCase()).toContain('no motivational filler');
  });
});

describe('buildContextBlock', () => {
  it('omits every part that is absent', () => {
    const block = buildContextBlock(minimalCtx);
    expect(block).toBe('Today: 2026-09-16');
    expect(block).not.toContain('Exercise');
    expect(block).not.toContain('Session');
    expect(block).not.toContain('Plan');
    expect(block).not.toContain('Bodyweight');
    expect(block).not.toContain('Nutrition');
  });

  it('omits optional exercise fields that are absent but keeps the ones present', () => {
    const ctx: AssistantContext = {
      today: '2026-09-16',
      exercise: { name: 'Barbell Back Squat', muscleGroup: 'quads', lastSessions: [] },
    };
    const block = buildContextBlock(ctx);
    expect(block).toContain('Exercise: Barbell Back Squat (quads)');
    expect(block).not.toContain('Cue');
    expect(block).not.toContain('Notes');
    expect(block).not.toContain('Prescription');
    expect(block).not.toContain('Last sessions');
    expect(block).not.toContain('Bests');
    expect(block).not.toContain('Stall');
  });

  it('caps the last-sessions list at the first 3 items given (caller orders most-recent-first)', () => {
    const ctx: AssistantContext = {
      today: '2026-09-16',
      exercise: {
        name: 'Bench Press (Barbell)',
        muscleGroup: 'chest',
        lastSessions: [
          { date: '2026-09-15', sets: '3x8@85kg' },
          { date: '2026-09-12', sets: '3x8@82.5kg' },
          { date: '2026-09-08', sets: '3x8@82.5kg' },
          { date: '2026-09-04', sets: '3x8@80kg' },
          { date: '2026-09-01', sets: '3x8@80kg' },
        ],
      },
    };
    const block = buildContextBlock(ctx);
    const line = block.split('\n').find((l) => l.startsWith('Last sessions:'));
    expect(line).toBeDefined();
    expect(line!.split(';').length).toBe(3);
    expect(line).toContain('2026-09-15');
    expect(line).toContain('2026-09-12');
    expect(line).toContain('2026-09-08');
    expect(line).not.toContain('2026-09-04');
    expect(line).not.toContain('2026-09-01');
  });

  it('caps session.logged and plan.exercises lists at 3 items', () => {
    const ctx: AssistantContext = {
      today: '2026-09-16',
      session: { title: 'Upper (Push)', elapsedMin: 22, logged: ['Bench 3x8@80', 'OHP 3x8@45', 'Dips 3x10', 'Lateral raise 3x15'] },
      plan: { routine: 'Push', exercises: ['Bench', 'OHP', 'Dips', 'Lateral raise', 'Triceps pushdown'] },
    };
    const block = buildContextBlock(ctx);
    const loggedLine = block.split('\n').find((l) => l.startsWith('Logged:'))!;
    expect(loggedLine.split(';').length).toBe(3);
    expect(loggedLine).not.toContain('Lateral raise');
    const planLine = block.split('\n').find((l) => l.startsWith('Plan:'))!;
    expect(planLine).not.toContain('Triceps pushdown');
  });

  it('includes bodyweight delta only when present, with sign', () => {
    const withDelta = buildContextBlock({ today: '2026-09-16', bodyweight: { latestKg: 74.2, weeklyDeltaKg: 0.3 } });
    expect(withDelta).toContain('Bodyweight: 74.2 kg (+0.3 kg/wk)');
    const withoutDelta = buildContextBlock({ today: '2026-09-16', bodyweight: { latestKg: 74.2 } });
    expect(withoutDelta).toContain('Bodyweight: 74.2 kg');
    expect(withoutDelta).not.toContain('kg/wk');
    const negDelta = buildContextBlock({ today: '2026-09-16', bodyweight: { latestKg: 74.2, weeklyDeltaKg: -0.2 } });
    expect(negDelta).toContain('(-0.2 kg/wk)');
  });

  it('shows nutrition targets only when set', () => {
    const withTargets = buildContextBlock({
      today: '2026-09-16',
      nutrition: { kcal: 1800, kcalTarget: 2200, proteinG: 120, proteinTargetG: 160 },
    });
    expect(withTargets).toContain('Nutrition: 1800/2200 kcal, 120/160 g protein');
    const withoutTargets = buildContextBlock({ today: '2026-09-16', nutrition: { kcal: 1800, proteinG: 120 } });
    expect(withoutTargets).toContain('Nutrition: 1800 kcal, 120 g protein');
  });

  it('caps the whole block at roughly 350 words', () => {
    const longNotes = Array.from({ length: 500 }, (_, i) => `word${i}`).join(' ');
    const ctx: AssistantContext = {
      today: '2026-09-16',
      exercise: { name: 'Deadlift', muscleGroup: 'hamstrings', notes: longNotes, lastSessions: [] },
    };
    const block = buildContextBlock(ctx);
    const wordCount = block.split(/\s+/).filter(Boolean).length;
    expect(wordCount).toBeLessThanOrEqual(350);
  });

  it('is deterministic for the same input', () => {
    const ctx: AssistantContext = { today: '2026-09-16', bodyweight: { latestKg: 74 } };
    expect(buildContextBlock(ctx)).toBe(buildContextBlock(ctx));
  });
});

describe('buildPrompt', () => {
  const thread: AssistantTurn[] = [
    { role: 'user', text: 'turn 1' },
    { role: 'assistant', text: 'reply 1' },
    { role: 'user', text: 'turn 2' },
    { role: 'assistant', text: 'reply 2' },
    { role: 'user', text: 'turn 3' },
    { role: 'assistant', text: 'reply 3' },
  ];

  it('truncates the thread to the last 4 turns', () => {
    const prompt = buildPrompt(minimalCtx, thread, 'new question');
    expect(prompt).not.toContain('turn 1');
    expect(prompt).not.toContain('reply 1');
    expect(prompt).toContain('User: turn 2');
    expect(prompt).toContain('Assistant: reply 2');
    expect(prompt).toContain('User: turn 3');
    expect(prompt).toContain('Assistant: reply 3');
  });

  it('puts the context block first and the question last', () => {
    const prompt = buildPrompt({ today: '2026-09-16' }, [], 'how much did I lift?');
    const lines = prompt.split('\n');
    expect(lines[0]).toBe('Today: 2026-09-16');
    expect(lines[lines.length - 1]).toBe('User: how much did I lift?');
  });

  it('is deterministic for the same input', () => {
    const a = buildPrompt(minimalCtx, thread, 'q');
    const b = buildPrompt(minimalCtx, thread, 'q');
    expect(a).toBe(b);
  });
});

describe('trimReply', () => {
  it('trims surrounding whitespace', () => {
    expect(trimReply('  hello  ')).toBe('hello');
  });

  it('collapses more than two consecutive blank lines to one', () => {
    expect(trimReply('a\n\n\n\n\nb')).toBe('a\n\nb');
  });

  it('leaves short replies with a blank line pair untouched', () => {
    expect(trimReply('a\n\nb')).toBe('a\n\nb');
  });

  it('leaves replies at or under the cap unchanged', () => {
    const text = 'x'.repeat(1200);
    expect(trimReply(text)).toBe(text);
  });

  it('caps long replies at a sentence boundary under 1200 characters', () => {
    const sentence = 'This is a short sentence. ';
    const text = sentence.repeat(60); // well over 1200 chars
    const result = trimReply(text);
    expect(result.length).toBeLessThanOrEqual(1200);
    expect(result.endsWith('.')).toBe(true);
  });

  it('falls back to a word boundary when there is no sentence-ending punctuation', () => {
    const text = Array.from({ length: 400 }, (_, i) => `w${i}`).join(' ');
    const result = trimReply(text);
    expect(result.length).toBeLessThanOrEqual(1200);
    expect(result.endsWith(' ')).toBe(false);
    expect(text.startsWith(result)).toBe(true);
  });
});
