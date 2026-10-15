/**
 * The owner's conversation from their screenshots, run through the pieces in the order the coach
 * screen will use them: route the message, read the request, build, write it as text, read the text
 * back as the Review routine sheet does.
 * Nothing here is mocked: every step is the real function over the real library.
 */
import { describe, expect, it } from 'vitest';
import { seededInput } from '../test/routineFixtures';
import { routeCoachMessage } from './coachIntent';
import { parseQuickRequest } from './quickRequest';
import { buildRoutines, routineRequestFrom, routineToText } from './routineBuilder';
import { parseRoutineText } from './routineText';

const REAL = seededInput({ recency: { shoulders: 6, 'rear delts': 6 } });

describe('the owner\'s conversation', () => {
  it('"Give me a routine solely designed to build 3D shoulders" is built, with six different exercises across both groups, two of them lateral raises, and no model involved', () => {
    const message = 'Give me a routine solely designed to build 3D shoulders';
    expect(routeCoachMessage(message, { lastWasRoutine: false })).toBe('build');
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const [routine] = buildRoutines(REAL, routineRequestFrom(parseQuickRequest(message)), seed);
      expect(routine!.rows).toHaveLength(6);
      expect(new Set(routine!.rows.map((r) => r.name)).size).toBe(6);
      // One press, the side delts twice, the rear delts twice, and a front raise or an upright row.
      expect(new Set(routine!.rows.map((r) => r.pattern)).size).toBe(5);
      expect(routine!.rows.filter((r) => r.pattern === 'lateral-raise')).toHaveLength(2);
      expect(new Set(routine!.rows.map((r) => r.muscleGroup))).toEqual(new Set(['shoulders', 'rear delts']));
      // Where the model gave DB Shoulder Press three times and Lateral Raise twice.
      expect(routine!.rows.filter((r) => r.name === 'DB Shoulder Press')).toHaveLength(1);
      expect(routine!.rows.filter((r) => r.name === 'Lateral Raise')).toHaveLength(1);
    }
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
});
