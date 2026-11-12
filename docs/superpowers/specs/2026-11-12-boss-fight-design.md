# Boss fight — design

November 2026. Replaces Home's strength figure (`ui/StrengthBody.tsx`), which itself replaced
Today's hand. Both were rejected by the owner as useless.

## Intent and the why

The owner wants Iron to feel like a game, and the game on Home to be worth looking at. In their
words, the two things it replaces "didn't tell me anything or show me anything or allow me to DO
anything. I gained no inspiration or confidence from them." Confidence, for them, comes from a new
PB (also from looking good in the mirror and feeling big and strong, which this feature does not
try to cover).

So the replacement must tell them something they did not know, show it, give them one thing to
do right there, and leave them with a reason to feel confident. Out of three mock-ups (PBs on the
line, Race last time, Boss fight) they picked **Boss fight**, "with the health bar and maybe an
image of the exercise".

## What it is

Each week there is one **boss**: the owner's own best set on one lift, a PB the plan can beat. Home
shows it with that lift's robot render, a health bar, the **attack** (the planned set that beats
it) and **Fight**, which starts the routine that holds the lift. Beating it is said at the set and
on the summary, the boss goes into a row of **bosses beaten**, and the next boss appears straight
away. On Monday an unbeaten boss leaves quietly and a new one is picked.

```
THIS WEEK'S BOSS ─────────────────────
┌──────────────────────────────────────┐
│         [bench press robot render]   │
│ Bench Press (Barbell)                │
│ Best 85 kg × 5 · 1 September         │
│ HEALTH ■■■■■■■■■□            90%     │
│ Your attack  82.5 kg × 7             │
│              Upper (Push)            │
│ [            Fight              ]    │
└──────────────────────────────────────┘
BOSSES BEATEN ────────────────────────
 (80 × 5)  (120 × 5)  (140 × 3)
  Bench     Squat      Deadlift
```

## Goals

- One boss at a time, Monday to Sunday, always beatable by the plan as it stands.
- Every figure comes from the owner's own sets and plan. No figure from a model, no guessed weight.
- The health bar moves only when a set gets closer to the boss than before, and reaches zero only
  on a set that beats it.
- Beating a boss is a moment: at the set, on the summary, and in the trophy row.

## Non-goals

- No notification (phone notifications are limited to the four in `domain/reminders.ts`).
- No coach line about the boss (the coach's moments are unchanged).
- No stretch targets: the plan is never raised to make a fight. The owner turned that down in
  favour of "today's plan".
- No boss for a carry, a hold, a bodyweight-only lift or a lift still calibrating.
- No mirror, photo or body-size feature.

## Anti-goals (a failure even if it works)

- A health bar that flatters: falling on sets that did not get closer, or reading 0% on a boss
  not beaten.
- A boss the plan cannot beat.
- Text written over a robot render (product rule).
- A boss that hops from lift to lift during the week.

## Constraints

- Offline. Nothing leaves the phone. The boss record is local like every other table.
- British English, kilograms, dark only, the open-ledger look of docs/DESIGN.md: a frame only
  round an object (the boss plaque is one: `Card framed`), brass labels with a hairline, light
  figures.
- Pure rules in `src/domain/` with unit tests before any UI; e2e on real sessions in the built
  app (CLAUDE.md, Verification).
- Build the Ponytail way: reuse `level.ts`'s set size, `GameMarks.tsx` (Segments, Medallion,
  HexPanel), `ExerciseHero`/`robotSrc`, `nextSessionPlan`, the existing Start path.

## Approaches considered

1. **Store each boss when it appears (picked).** One small record per boss: the week, the lift,
   the boss set. Health, the attack and "beaten" are always read from the sets and the live plan.
   The boss holds still all week, the trophy row is exact, and deleting the PB set un-beats it.
2. **Derive everything each time, store nothing.** Cheaper, but the plan's weights move after
   every session, so the boss would hop mid-week, and past plans are not kept, so past bosses
   (the trophy row) could not be rebuilt. Dropped.
3. **Pick from past sets only, ignoring the plan.** No storage and replayable, but some weeks the
   boss would need more than the plan gives: the stretch PB the owner turned down. Dropped.

The owner handed the how over; approach 1 is the agent's call.

## The rules (agreed with the owner)

1. **Set size.** A set's size is the Level's: weight × (1 + reps ÷ 30) (`domain/level.ts`), over
   the sets that count for records outside a light quick session, matched by exercise across every
   routine, exactly as `db/gameQueries.ts` gathers them for Levels. A session filled in by the
   coach ("as planned") counts, as it does for Levels and records (agent's call: one rule for the
   whole game). "Beats" uses `levelFor`'s comparison, its float tolerance included.
2. **Candidates.** Exercises of kind `reps` in a current routine (not archived, not quick), with
   the routine-exercise in `normal` mode (not calibrating), whose Level start is set (three
   counted sessions; `levelFor` gives a level).
3. **Boss set.** The candidate's biggest counted set ever, by size. Its date is the session's.
4. **Attack.** At the weight the plan gives for the lift's next session (the first current
   routine that holds it, routines in their `order` as `gameQueries` reads them, as
   `nextSessionPlan` prescribes it, no deload), the fewest reps within the rep range whose size
   beats the boss. No such reps: the lift is not a candidate. Plans are worked out for every
   candidate only at pick time; Home afterwards works out the plan of the boss's routine alone.
   The attack shown is always the live plan's. If, mid-week, the plan no longer reaches the boss
   (a missed session can hold or lower the weight), the boss stays: the plaque shows the plan's
   top set and that it falls short, and Fight still starts the routine (agent's call: the boss
   never hops).
5. **Pick.** Of the candidates not yet bossed this week, the one whose attack beats its boss by
   the smallest margin, (attack size − boss size) ÷ boss size: the hardest fight the plan still
   wins. Ties go to the exercise name, A to Z.
6. **When a boss appears.** When Home is shown and this week has no live boss: none picked yet, or
   the latest one is beaten. Picking writes the record. A lift is boss at most once a week, so a
   week can hold several bosses, one after another, until no candidate is left. Weeks run Monday
   to Sunday by the phone's local date, as everywhere else in the app (`mondayOf`).
7. **Beaten.** A counted set on the boss's lift, logged from the moment the boss appeared to the
   end of that Sunday, whose size beats the boss. A set in a session still open counts (the flash
   happens live). Deleting or editing that set changes the answer: beaten is read from the sets,
   never stored.
8. **Health.** 100% until the week's best set on the lift (from the moment the boss appeared)
   gets closer than the floor, then (boss − week's best) ÷ (boss − floor), and 0% only when
   beaten. The floor is the size of the top set of the lift's last counted session before the
   boss appeared; with none, or one not below the boss, it is 90% of the boss. Shown in the ten
   `Segments` with the percentage rounded up, so a boss not beaten never reads 0%.
9. **Monday.** A boss not beaten by the end of Sunday leaves quietly; only wins are listed.
10. **No fight.** No candidate (a new lift, a deload, nothing in routines): the section is not
    shown. After the week's last possible boss is beaten, the beaten one stays on the plaque,
    marked Beaten, until Monday.

## Screens

- **Home**, in place of the strength figure, under the routine that leads: a labelled section,
  "This week's boss", holding the framed plaque. Top: the lift's robot render (`ExerciseHero`,
  nothing over it); a lift without a render gets a brass hexagon with the boss weight in it.
  Below: the exercise name, "Best 85 kg × 5 · 1 September", the health bar, the attack with the
  routine's name, and **Fight**, which starts that routine through the same path as a routine
  card's Start (including its guards). While a session is running, Fight is not offered, as Start
  is not.
- **Bosses beaten**: a row of medallions, newest first, each the boss set ("85 × 5") over the
  exercise name. Shown once one boss has been beaten.
- **At the set**: the set that beats the boss says so in the one toast that already carries
  "Record" and "Level", with the record flash: "Record · 82.5 kg × 7 · Boss beaten" (and
  "· Level 4" when it also levels up).
- **Summary**: a "Boss beaten" `HexPanel` beside the Level up panel, naming the lift and the set.

## Data

A new Dexie table, `bosses`: `id`, `week` (the Monday's date key, `mondayOf`), `exerciseId`,
`weight`, `reps`, `appearedAt` (ISO), with a unique compound index on `[week+exerciseId]` so two
picks running at once cannot both write. Carried in the JSON backup like every other table (a
backup version step, so an older build refuses a newer file as it does now); restoring an older
file that has no `bosses` leaves the table as it is, as `tablesInBackup` already does for missing
tables. A boss whose exercise is no longer there is not shown. Nothing else is stored.

## What goes

`ui/StrengthBody.tsx`, `domain/strengthBody.ts` and its test, the strength-figure lines in
CLAUDE.md and docs/DESIGN.md, and the strength-figure e2e checks. The glutes-over-hamstrings
order in `BodyMap.tsx` stays (it fixed a real mis-tap on Progress).

## Left to the builder

- Where the pick runs (it writes, so not inside a `useLiveQuery`; a Home effect and after a
  session is saved are the obvious places), and keeping it idempotent if two run at once.
- What the plaque says if the boss's lift leaves every routine mid-week (the boss stays; the
  attack and Fight cannot be shown).
- The exact sizes, spacing and copy within the rules above and docs/DESIGN.md.
- Test seams: domain functions for candidates, attack, pick, health and beaten, each tested
  directly; e2e through real sessions of the seed's routines.
