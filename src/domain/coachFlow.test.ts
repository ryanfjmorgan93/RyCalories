/**
 * The owner's conversation from their screenshots, run through the pieces in the order the coach
 * screen will use them: route the message, read the request, build, write it as text, read the text
 * back as the Review routine sheet does, and put the routine in front of the model for "why".
 * Nothing here is mocked: every step is the real function over the real library.
 */
import { describe, expect, it } from 'vitest';
import { seededInput } from '../test/routineFixtures';
import { routeCoachMessage } from './coachIntent';
import { buildCoachPrompt, buildCoachSystemPrompt, buildRoutineBlock } from './coach';
import { parseQuickRequest } from './quickRequest';
import { buildRoutines, routineRequestFrom, routineToText } from './routineBuilder';
import { parseRoutineText } from './routineText';

const REAL = seededInput({ recency: { shoulders: 6, 'rear delts': 6 } });

describe('the owner\'s conversation', () => {
  it('"Give me a routine solely designed to build 3D shoulders" is built, with six different movements across both groups, and no model involved', () => {
    const message = 'Give me a routine solely designed to build 3D shoulders';
    expect(routeCoachMessage(message, { lastWasRoutine: false })).toBe('build');
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const [routine] = buildRoutines(REAL, routineRequestFrom(parseQuickRequest(message)), seed);
      expect(routine!.rows).toHaveLength(6);
      expect(new Set(routine!.rows.map((r) => r.name)).size).toBe(6);
      expect(new Set(routine!.rows.map((r) => r.pattern)).size).toBe(6);
      expect(new Set(routine!.rows.map((r) => r.muscleGroup))).toEqual(new Set(['shoulders', 'rear delts']));
      // Where the model gave DB Shoulder Press three times and Lateral Raise twice.
      expect(routine!.rows.filter((r) => r.name === 'DB Shoulder Press')).toHaveLength(1);
      expect(routine!.rows.filter((r) => r.name === 'Lateral Raise')).toHaveLength(1);
    }
  });

  it('"Why have you chosen this?" is a question, and the model is given the routine and why, not asked to write one again', () => {
    const built = buildRoutines(REAL, routineRequestFrom(parseQuickRequest('Give me a routine solely designed to build 3D shoulders')), 3);
    expect(routeCoachMessage('Why have you chosen this?', { lastWasRoutine: true })).toBe('ask');
    const system = buildCoachSystemPrompt('ask');
    expect(system).not.toMatch(/reply with the routine/i);
    const prompt = buildCoachPrompt('', [], 'Why have you chosen this?', buildRoutineBlock(built));
    expect(prompt).toContain('Routine the app built:');
    expect(prompt).toContain('Why:');
    expect(prompt).toContain('Focus: shoulders and rear delts, as asked');
    for (const row of built[0]!.rows) expect(prompt).toContain(`${row.name}: ${row.reason}`);
    expect(prompt.endsWith('User: Why have you chosen this?')).toBe(true);
  });

  it('"?" and "Doesn\'t matter, I want 3d shoulders" after a routine: the first is a question, the second builds again', () => {
    expect(routeCoachMessage('?', { lastWasRoutine: true })).toBe('ask');
    const message = "Doesn't matter, I want 3d shoulders";
    expect(routeCoachMessage(message, { lastWasRoutine: true })).toBe('build');
    const [routine] = buildRoutines(REAL, routineRequestFrom(parseQuickRequest(message)), 9);
    expect(routine!.name).toBe('Shoulders and rear delts');
    expect(routineRequestFrom(parseQuickRequest(message))).toEqual({ focus: ['shoulders', 'rear delts'] });
  });

  it('what is built is what the Review routine sheet reads back', () => {
    for (const message of ['give me a routine for 3d shoulders', 'a push pull legs routine', 'give me six exercises for chest', 'build me a 45 minute upper body workout']) {
      expect(routeCoachMessage(message, { lastWasRoutine: false }), message).toBe('build');
      const built = buildRoutines(REAL, routineRequestFrom(parseQuickRequest(message)), 4);
      const parsed = parseRoutineText(routineToText(built)).routines;
      expect(parsed.map((p) => p.name), message).toEqual(built.map((b) => b.name));
      expect(parsed.map((p) => p.exercises.map((e) => e.name)), message).toEqual(built.map((b) => b.rows.map((r) => r.name)));
    }
  });

  it('the ask prompt and the routine block together stay far inside the model\'s limit of about four thousand tokens', () => {
    const built = buildRoutines(REAL, { focus: [], split: 'ppl' }, 5);
    const prompt = buildCoachPrompt('', [], 'Why?', buildRoutineBlock(built, 'full'));
    // About four characters to a token: the whole of a three-day split and every reason is well under half the limit.
    expect(buildCoachSystemPrompt('ask').length + prompt.length).toBeLessThan(8000);
  });
});
