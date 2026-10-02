import { describe, expect, it } from 'vitest';
import { routeCoachMessage, type CoachRoute } from './coachIntent';

/**
 * [what was typed, whether a routine the coach built is the subject, where it goes].
 * Where it goes is a routine built afresh ('build'), the routine on screen changed ('edit'), or a
 * question for the model ('ask').
 */
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

  // After a routine, a muscle changes THAT routine: it is an edit, not a second routine built from the new words alone.
  // (These rows were 'build' before edits existed; the words and the thing they ask for are the same.)
  ['more rear delts', true, 'edit'],
  ['shoulders', true, 'edit'],
  ['add calves', true, 'edit'],
  ['no legs', true, 'edit'],
  ['just chest', true, 'edit'],
  ['actually 3d shoulders', true, 'edit'],
  ['swap it for 3d shoulders', true, 'edit'],
  ['make it more shoulders', true, 'edit'],
  // Before one there is nothing to change: the same words are a question.
  ['more rear delts', false, 'ask'],
  ['no legs', false, 'ask'],
  ['add calves', false, 'ask'],

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
  ['my push routine', false, 'ask'],
  ['your chest routine', true, 'ask'],
  ['this leg day', true, 'ask'],
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
  ['make it harder', false, 'ask'],
  ['build muscle', false, 'ask'],
  ['plan', false, 'ask'],
  ['i want to know why', true, 'ask'],
  ['i want to know about my shoulders', false, 'ask'],
  ['I want to lose weight', false, 'ask'],
  ['I need a break', false, 'ask'],
  ['I want to bench more', false, 'ask'],
  ['any chest routine ideas', false, 'ask'],

  // Greetings, slang and the ways a person opens a request: still a request for a routine, with or without one on screen.
  ['hey can you do me a shoulder session', false, 'build'],
  ['hey can you do me a shoulder session', true, 'build'],
  ['looking for a chest workout', false, 'build'],
  ['looking for a chest workout', true, 'build'],
  ['can I get a leg day', false, 'build'],
  ['can I get a leg day', true, 'build'],
  ['sort me a back sesh', false, 'build'],
  ['sort me a back sesh', true, 'build'],
  ['chuck me some arms', false, 'build'],
  ['chuck me some arms', true, 'build'],
  ['yo give me a chest workout', false, 'build'],
  ['yo give me a chest workout', true, 'build'],
  ['mate give me a chest routine', false, 'build'],
  ['cheers mate, now give me a back routine', false, 'build'],
  ['cheers mate, now give me a back routine', true, 'build'],
  ['do me a chest routine', false, 'build'],
  ['do me a chest routine', true, 'build'],
  ['do us a leg day', false, 'build'],
  ['can i get a chest routine', false, 'build'],
  ['can i get a chest routine', true, 'build'],
  ['can i have a leg routine', false, 'build'],
  ['could i have a chest routine', false, 'build'],
  ['can we do chest', false, 'build'],
  ['im looking for a chest routine', false, 'build'],
  ['looking for a chest routine', false, 'build'],
  ["i'm after a chest routine", false, 'build'],
  ['get me a push day', false, 'build'],
  ['lob me a pull workout', false, 'build'],
  ['a beginner chest routine', false, 'build'],
  // A question that happens to open like a request is still a question.
  ['can I do chest after legs?', false, 'ask'],
  ['can I train legs today?', true, 'ask'],
  ['looking for advice on chest', false, 'ask'],
  ['can I get some advice on legs', false, 'ask'],

  // A routine pointed at is not a routine asked for: this, my, the, your.
  ['make this routine harder', false, 'ask'],
  ['make my routine shorter', false, 'ask'],
  ['make the routine shorter', false, 'ask'],
  ['give me the reasons for this routine', false, 'ask'],
  ['give me the reasons for this routine', true, 'ask'],
  ['give me a summary of this routine', true, 'ask'],
  ['give me a rundown of my routine', true, 'ask'],
  ['give me feedback on my routine', true, 'ask'],
  ['give me a breakdown of the routine', true, 'ask'],
  ['give me a progression plan', false, 'ask'],
  ['make me a meal plan', false, 'ask'],
  ['make me a meal plan', true, 'ask'],
  ['give me a diet plan', true, 'ask'],

  // A trailing question mark after a routine: the routine is being asked about, not added to.
  ['rear delts?', true, 'ask'],
  ['shoulders?', true, 'ask'],
  ['chest ok?', true, 'ask'],
  ['no legs in it?', true, 'ask'],
  ['no chest?', true, 'ask'],
  ['more rear delts?', true, 'ask'],
  ['legs?', true, 'ask'],
  ['harder?', true, 'ask'],
  ['shorter?', true, 'ask'],
  ['what does a lateral raise work?', true, 'ask'],
  ['why have you chosen this?', true, 'ask'],
  ['is that too many sets', true, 'ask'],
  ['how many sets is that', true, 'ask'],
  ['rear delts covered?', true, 'ask'],
  ['any legs?', true, 'ask'],

  // The routine on screen is changed: another one, a different length, harder or easier, a muscle added or dropped, a row swapped.
  ['give me another one', true, 'edit'],
  ['another one', true, 'edit'],
  ['another', true, 'edit'],
  ['again', true, 'edit'],
  ['try again', true, 'edit'],
  ['different one', true, 'edit'],
  ['give me a different one', true, 'edit'],
  ['give me something else', true, 'edit'],
  ['something else', true, 'edit'],
  ['another routine', true, 'edit'],
  ['give me a new one', true, 'edit'],
  ['make it different', true, 'edit'],
  ['redo', true, 'edit'],
  ['shuffle', true, 'edit'],
  ['mix it up', true, 'edit'],
  ['switch it up', true, 'edit'],
  ['swap the front raise', true, 'edit'],
  ['swap front raise', true, 'edit'],
  ['swap the front raise for something else', true, 'edit'],
  ['swap out the front raise', true, 'edit'],
  ['replace the press', true, 'edit'],
  ['replace the press with something else', true, 'edit'],
  ['change the lateral raise', true, 'edit'],
  ['switch the face pull for a cable one', true, 'edit'],
  ['remove the front raise', true, 'edit'],
  ['drop the face pull', true, 'edit'],
  ['take out the front raise', true, 'edit'],
  ['get rid of the press', true, 'edit'],
  ['ditch the shrugs', true, 'edit'],
  ['no front raises', true, 'edit'],
  ['can you swap the front raise?', true, 'edit'],
  ['could you make it shorter?', true, 'edit'],
  ['make it 5 exercises', true, 'edit'],
  ['5 exercises', true, 'edit'],
  ['only 5 exercises', true, 'edit'],
  ['make it 5', true, 'edit'],
  ['four exercises', true, 'edit'],
  ['fewer', true, 'edit'],
  ['fewer exercises', true, 'edit'],
  ['less exercises', true, 'edit'],
  ['more', true, 'edit'],
  ['more exercises', true, 'edit'],
  ['one more', true, 'edit'],
  ['add another exercise', true, 'edit'],
  ['drop one', true, 'edit'],
  ['shorter', true, 'edit'],
  ['make it shorter', true, 'edit'],
  ['make the routine shorter', true, 'edit'],
  ['make my routine shorter', true, 'edit'],
  ['a bit shorter', true, 'edit'],
  ['quicker', true, 'edit'],
  ['make it quicker', true, 'edit'],
  ['30 mins', true, 'edit'],
  ['make it 45 minutes', true, 'edit'],
  ['half an hour', true, 'edit'],
  ['longer', true, 'edit'],
  ['make it longer', true, 'edit'],
  ['harder', true, 'edit'],
  ['make it harder', true, 'edit'],
  ['make this routine harder', true, 'edit'],
  ['a bit harder', true, 'edit'],
  ['tougher', true, 'edit'],
  ['heavier', true, 'edit'],
  ['easier', true, 'edit'],
  ['make it easier', true, 'edit'],
  ['lighter', true, 'edit'],
  ['more sets', true, 'edit'],
  ['fewer sets', true, 'edit'],
  ['less volume', true, 'edit'],
  ['add biceps', true, 'edit'],
  ['also chest', true, 'edit'],
  ['include triceps', true, 'edit'],
  ['more biceps', true, 'edit'],
  ['extra calves', true, 'edit'],
  ['drop the legs', true, 'edit'],
  ['without legs', true, 'edit'],
  ['skip legs', true, 'edit'],
  ['lose the legs', true, 'edit'],
  ['switch to legs', true, 'edit'],
  ['chest', true, 'edit'],
  ['chest and triceps', true, 'edit'],
  ['make it a push day', true, 'edit'],
  ['make it push pull legs', true, 'edit'],
  ['dumbbells only', true, 'edit'],
  ['no barbell', true, 'edit'],
  ['add biceps and make it 8 exercises', true, 'edit'],
  ['make it shorter and easier', true, 'edit'],
  // The same words with nothing to change are not a request.
  ['shorter', false, 'ask'],
  ['harder', false, 'ask'],
  ['swap the front raise', false, 'ask'],
  ['give me another one', false, 'ask'],
  ['make it 5 exercises', false, 'ask'],
  // With a routine on screen, a whole new request is still a new routine.
  ['give me a routine for chest', true, 'build'],
  ['give me a 45 minute shoulder routine', true, 'build'],
  ['make me a push day', true, 'build'],
  ['build me a chest and triceps routine', true, 'build'],
  ['I want a back routine', true, 'build'],
  ['give me a chest routine, no triceps', true, 'build'],
  ['a new chest routine', true, 'build'],
  ['push day', true, 'build'],
  ['give me chest', true, 'build'],
  ['plan my legs', true, 'build'],
  ['draft an upper lower split', true, 'build'],
  ['generate a ppl routine', true, 'build'],
  // The owner's own numbers and history, asked in the clipped way of someone typing on a phone: a question, routine or no routine.
  ['chest volume', true, 'ask'],
  ['chest volume this month', true, 'ask'],
  ['bench press progress', true, 'ask'],
  ['shoulders last week', true, 'ask'],
  ['my chest', true, 'ask'],
  ['chest pr', true, 'ask'],
  ['shoulders sets per week', true, 'ask'],
  ['lateral raise weight', true, 'ask'],
  ['legs sore', true, 'ask'],
  ['my shoulder hurts', true, 'ask'],
  // More ways a message names a row, a length or a count.
  ['swap the bench for dumbbell bench', true, 'edit'],
  ['replace bench press with dumbbell press', true, 'edit'],
  ['two more', true, 'edit'],
  ['add 2 exercises', true, 'edit'],
  ['4 fewer', true, 'edit'],
  ['make it 12 exercises', true, 'edit'],
  ['cut it down', true, 'edit'],
  ['get me another one', true, 'edit'],
  ['legs instead', true, 'edit'],
  ['take out the barbell', true, 'edit'],
  ['no machines', true, 'edit'],
  ['swap legs for arms', true, 'edit'],
  ['I want it shorter', true, 'edit'],
  ['can you make it harder', true, 'edit'],
  ['can you add calves', true, 'edit'],
  ['can you do legs', true, 'ask'],
  ['make it 5 exercises', false, 'ask'],
  // Said about the routine, with no change asked for.
  ['this routine is too long', true, 'ask'],
  ['my routine is shorter than yesterday', true, 'ask'],
  ['thanks again', true, 'ask'],
  ['it is hard', true, 'ask'],
  ['too many exercises', true, 'ask'],
  ['I am tired', true, 'ask'],

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
  it('has the owner\'s four messages, every phrase the review turned up, and at least eighty distinct real phrases', () => {
    const phrases = new Set(TABLE.map(([text]) => text.trim().toLowerCase()));
    expect(phrases.size).toBeGreaterThanOrEqual(80);
    const owners = ['Give me a routine solely designed to build 3D shoulders', 'Why have you chosen this?', '?', "Doesn't matter, I want 3d shoulders"];
    // The phrases the review measured going to the wrong place.
    const reviewed = [
      'make this routine harder', 'give me the reasons for this routine', 'give me feedback on my routine', 'make me a meal plan', 'yo give me a chest workout', 'do me a chest routine',
      'can i get a chest routine', 'looking for a chest routine', 'swap the front raise', 'make it shorter', 'harder', '30 mins', 'give me another one', 'try again',
      'rear delts?', 'chest ok?', 'no legs in it?', 'add biceps', 'no legs', 'make it 5 exercises', 'more rear delts',
      'hey can you do me a shoulder session', 'looking for a chest workout', 'can i get a leg day', 'sort me a back sesh', 'chuck me some arms',
    ];
    for (const phrase of [...owners, ...reviewed]) expect(phrases.has(phrase.toLowerCase()), phrase).toBe(true);
  });

  it('sends each kind of message to each of the three places', () => {
    for (const route of ['build', 'edit', 'ask'] as const) expect(TABLE.filter(([, , to]) => to === route).length, route).toBeGreaterThanOrEqual(20);
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

  it('a muscle on its own is a question until a routine has been built, and a change to it after one', () => {
    for (const word of ['shoulders', 'chest', 'legs', 'rear delts', 'arms', 'back']) {
      expect(routeCoachMessage(word, { lastWasRoutine: false }), word).toBe('ask');
      // This was 'build' before edits: the same words, and now they change the routine that is there.
      expect(routeCoachMessage(word, { lastWasRoutine: true }), word).toBe('edit');
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
