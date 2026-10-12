# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Ships as an Android app (Capacitor WebView) on the owner's Galaxy Z Fold 8: the narrow cover
screen in the gym, the unfolded inner screen at home. The design language is the app's own, not
Material.

## Users
One person: the owner, a UK lifter training at a commercial gym. In the gym the phone sits on a
bench or in one hand between sets, with 1–3 minutes of rest, sweaty fingers and harsh overhead
light. At home, usually in the evening, they log food. Once a week they weigh in; now and then
they scan on the gym's InBody machine. Workouts are used most, then food.

## Product Purpose
Iron makes progressive overload and calorie tracking effortless and keeps a personal trainer in
the pocket. Success, in the owner's words: "progressive overload and track my calories in an app
that looks pretty and is simple to use", with an assistant that is "just running with me" — "the
less manual entry I have to put in, the better".

## Positioning
A logger whose coach has read every set, meal, weigh-in and body scan the owner ever logged, and
speaks up like a good PT: during the session, after a meal, on Monday. Tracking works with no
signal; the coach (Claude) needs the internet and says so plainly when it has none.

## Operating Context
- Between sets: log weight and reps in one tap, see what is next, hear one line from the coach,
  ask it to change today's plan ("too many sets on this one") by voice or text.
- Food: photograph a plate, scan a barcode ("whole pack or half?"), or describe a meal; Claude
  fills it in. Natural units (a pack, a slice, two eggs), never grams first.
- Monday: weigh-in card and a weekly review (training, food, weight, body composition).
- Notifications: a late-day food reminder, a training nudge naming neglected muscle groups, the
  Monday weigh-in.

## Capabilities and Constraints
- Kilograms only, British English, no emojis, tap targets at least 44 px.
- Dark only (the owner removed the light theme). Works fully offline for tracking.
- Android WebView: real `backdrop-filter` blur only on layers fixed to the viewport.
- Every figure honest: no clamping, no averages that hide unlogged days.
- Claude's own estimates are marked ≈ and carry the lowest trust.
- Monthly spending cap on Claude; tracking unaffected when it is reached.

## Brand Commitments
- Name: Iron.
- Voice: a nice PT — to the point, encouraging, the odd motivational line, asks after the
  owner's mental health now and then. Praise when earned; plain when something is off.
- The owner's verdict on the current look: "AI slop… so flat and material". The replacement must
  look considered and alive. Hevy is a reference the owner offered, not a requirement ("you don't
  have to stick to that… free rein").

## Evidence on Hand
- The owner's real training, food and bodyweight history lives on the phone (not in the repo).
- Exercise media: 518 catalogue entries with photographs (`public/catalogue/`) and 303 diagram
  demos (`public/exercises/`), both licensed (docs/ATTRIBUTION.md).
- No testimonials, users or metrics beyond the owner; none may be invented.

## Product Principles
1. Fewest taps wins. One tap to log a set; one tap to log a pack.
2. The coach earns every word: it speaks when it has something useful, otherwise it is quiet.
3. Numbers never flatter.
4. One hand, bright light, short rest: everything in the session reads at arm's length.
5. Tracking never waits on the network.

## Accessibility & Inclusion
Text contrast at least 4.5:1 against every surface it sits on (enforced by
`src/ui/tokens.test.ts`). Reduced motion respected globally.
