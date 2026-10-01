import { describe, expect, it } from 'vitest';
import { routeCoachMessage, type CoachRoute } from './coachIntent';

/** [what was typed, whether the coach's last reply was a routine, where it goes]. */
const TABLE: [string, boolean, CoachRoute][] = [
  // The owner's own screenshots.
  ['Give me a routine solely designed to build 3D shoulders', false, 'build'],
  ['Give me a routine solely designed to build 3D shoulders', true, 'build'],
  ['Why have you chosen this?', true, 'ask'],
  ['?', true, 'ask'],
  ["Doesn't matter, I want 3d shoulders", true, 'build'],
  ["Doesn't matter, I want 3d shoulders", false, 'build'],

  // Asked for with a verb.
  ['build me a push routine', false, 'build'],
  ['make me a leg day', false, 'build'],
  ['create a pull day', false, 'build'],
  ['write me a 4 day split', false, 'build'],
  ['design a routine for chest and triceps', false, 'build'],
  ['plan a full body workout', false, 'build'],
  ['plan my legs', false, 'build'],
  ['put together a routine for my shoulders', false, 'build'],
  ['sort me out a back workout', false, 'build'],
  ['give me 6 exercises for 3d shoulders', false, 'build'],
  ['give me chest', false, 'build'],
  ['give me a 45 minute shoulder routine', false, 'build'],
  ['give me a chest workout please', false, 'build'],
  ['ok give me a routine for legs', false, 'build'],
  ['Give me a routine for 3d delts?', false, 'build'],
  ['generate a ppl routine', false, 'build'],
  ['draft an upper lower split', false, 'build'],

  // Asked for politely.
  ['can you build me a leg routine', false, 'build'],
  ['could you make me a pull day?', false, 'build'],
  ['would you write a push routine', false, 'build'],
  ['can you please give me a back workout', false, 'build'],

  // Said as a want.
  ['I need a routine', false, 'build'],
  ['I want a chest routine', false, 'build'],
  ['I want 3d shoulders', false, 'build'],
  ['i want to build bigger arms', false, 'build'],
  ['I need to train legs', false, 'build'],
  ["I'd like a ppl routine", false, 'build'],
  ['I want a plan', false, 'build'],
  ['we need an upper body workout', false, 'build'],

  // The routine named, or a count of exercises for something.
  ['5 exercises for chest', false, 'build'],
  ['six exercises for back', false, 'build'],
  ['5 exercises for my chest', false, 'build'],
  ['six exercises for my back', false, 'build'],
  ['routine for chest', false, 'build'],
  ['workout for my back', false, 'build'],
  ['ppl', false, 'build'],
  ['push pull legs', false, 'build'],
  ['upper lower split', false, 'build'],
  ['full body workout', false, 'build'],
  ['push day', false, 'build'],
  ['leg day', false, 'build'],
  ['a new chest routine', false, 'build'],
  ['chest and triceps routine', false, 'build'],
  ['recommend a routine for chest', false, 'build'],
  ['push routine?', false, 'build'],

  // A muscle asked for after a routine.
  ['more rear delts', true, 'build'],
  ['shoulders', true, 'build'],
  ['add calves', true, 'build'],
  ['no legs', true, 'build'],
  ['just chest', true, 'build'],
  ['actually 3d shoulders', true, 'build'],
  ['swap it for 3d shoulders', true, 'build'],
  ['make it more shoulders', true, 'build'],

  // Questions.
  ['why is there no squat in my routine', false, 'ask'],
  ['is my push routine any good?', false, 'ask'],
  ['what should I train today?', false, 'ask'],
  ['what did I bench last week', false, 'ask'],
  ['how much did I squat on Monday?', false, 'ask'],
  ['How many sets of chest did I do this week?', false, 'ask'],
  ['which exercise is best for side delts?', false, 'ask'],
  ['when did I last train legs', false, 'ask'],
  ['do I need to train rear delts?', false, 'ask'],
  ['does a lateral raise work the rear delts', false, 'ask'],
  ['did I hit my protein target yesterday', false, 'ask'],
  ['should I add a fourth day?', false, 'ask'],
  ['can I train legs two days in a row?', false, 'ask'],
  ['could this routine be shorter?', true, 'ask'],
  ['would a split be better for me?', false, 'ask'],
  ['will this build bigger shoulders?', true, 'ask'],
  ['are lateral raises worth it', false, 'ask'],
  ["what's my current weight?", false, 'ask'],
  ["what's a good chest routine", false, 'ask'],
  ['how do I build bigger arms?', false, 'ask'],
  ['how long does this routine take', true, 'ask'],
  ['Is full body better than a split?', false, 'ask'],
  ['is 3d shoulders a real thing', false, 'ask'],
  ['how is my chest volume?', false, 'ask'],
  ['what is a rear delt fly?', false, 'ask'],
  ['what does 3d shoulders mean', true, 'ask'],
  ['what routine would you recommend for chest', false, 'ask'],
  ['is there a better routine for chest', false, 'ask'],
  ['why is my routine for chest so short', false, 'ask'],
  ['why', true, 'ask'],
  ['what about calves', true, 'ask'],
  ['do arms instead', true, 'ask'],

  // Said about the owner's own, with no request in it.
  ['my shoulders are sore', false, 'ask'],
  ['my shoulders are sore', true, 'ask'],
  ['my push routine is too long', false, 'ask'],
  ['this routine is too long', true, 'ask'],
  ['my routine', false, 'ask'],
  ['I did chest yesterday', true, 'ask'],
  ['tell me about 3d shoulders', false, 'ask'],
  ['tell me about 3d shoulders', true, 'ask'],
  ['tell me why you chose lateral raises', true, 'ask'],
  ['explain the routine', true, 'ask'],
  ['show me my routine', false, 'ask'],
  ['give me the reasons', true, 'ask'],
  ['give me a summary of my week', false, 'ask'],
  ['give me a break', false, 'ask'],
  ['make me a sandwich', false, 'ask'],
  ['make it harder', true, 'ask'],
  ['build muscle', false, 'ask'],
  ['plan', false, 'ask'],
  ['i want to know why', true, 'ask'],
  ['i want to know about my shoulders', false, 'ask'],
  ['I want to lose weight', false, 'ask'],
  ['I need a break', false, 'ask'],
  ['I want to bench more', false, 'ask'],
  ['any chest routine ideas', false, 'ask'],

  // Nothing, or nothing that says anything.
  ['', false, 'ask'],
  ['   ', true, 'ask'],
  ['??', true, 'ask'],
  ['...', false, 'ask'],
  ['thanks', true, 'ask'],
  ['ok', true, 'ask'],
  ['hello', false, 'ask'],
  ['\u0000\u0001', false, 'ask'],
];

describe('routeCoachMessage', () => {
  it('has the owner\'s four messages and at least sixty more real phrases', () => {
    expect(TABLE.length).toBeGreaterThanOrEqual(64);
  });

  it.each(TABLE)('%j (after a routine: %s) goes to %s', (text, lastWasRoutine, route) => {
    expect(routeCoachMessage(text, { lastWasRoutine })).toBe(route);
  });

  it('is the same however it is cased, spaced or punctuated', () => {
    for (const [text, last, route] of TABLE.filter(([t]) => t.trim().length > 2)) {
      expect(routeCoachMessage(text.toUpperCase(), { lastWasRoutine: last }), text).toBe(route);
      expect(routeCoachMessage(`  ${text}  `, { lastWasRoutine: last }), text).toBe(route);
    }
    expect(routeCoachMessage("DOESN’T MATTER, I WANT 3D SHOULDERS", { lastWasRoutine: true })).toBe('build');
  });

  it('a muscle on its own is a question until a routine has been built, and a request after one', () => {
    for (const word of ['shoulders', 'chest', 'legs', 'rear delts', 'arms', 'back']) {
      expect(routeCoachMessage(word, { lastWasRoutine: false }), word).toBe('ask');
      expect(routeCoachMessage(word, { lastWasRoutine: true }), word).toBe('build');
    }
  });

  it('anything that opens as a question is a question, whatever follows: a routine is only built for the owner when they ask for one', () => {
    const openers = ['why', 'what', 'how', 'which', 'when', 'is', 'are', 'do', 'does', 'did', 'should', 'can', 'could', 'would', 'will'];
    for (const opener of openers) {
      for (const tail of ['3d shoulders', 'a push routine', 'my chest routine', 'it any good', 'you do legs']) {
        expect(routeCoachMessage(`${opener} ${tail}`, { lastWasRoutine: true }), `${opener} ${tail}`).toBe('ask');
      }
    }
  });

  it('a polite request is still a request: "can you" and a verb that builds, with something to build', () => {
    expect(routeCoachMessage('can you build a push routine', { lastWasRoutine: false })).toBe('build');
    // And "can you" with anything else is a question.
    expect(routeCoachMessage('can you explain the routine', { lastWasRoutine: true })).toBe('ask');
    expect(routeCoachMessage('can you build', { lastWasRoutine: true })).toBe('ask');
  });

  it('never throws on anything', () => {
    for (const text of [undefined, null, 42, {}, [], 'x'.repeat(50000), '💪'.repeat(300), 'give me '.repeat(500)]) {
      expect(() => routeCoachMessage(text as never, { lastWasRoutine: true })).not.toThrow();
      expect(['build', 'ask']).toContain(routeCoachMessage(text as never, { lastWasRoutine: false }));
    }
  });
});
