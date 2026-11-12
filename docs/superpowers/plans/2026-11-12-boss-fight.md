# Boss Fight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Home's strength figure with a weekly boss: the owner's best set on one lift, a health bar, the planned set that beats it, Fight, a beaten moment at the set and on the summary, and a row of bosses beaten.

**Architecture:** Pure rules in `src/domain/boss.ts` (sizes, attack, pick, health, beaten). One stored row per boss in a new Dexie table `bosses`; everything else is read from the sets and the live plan in `src/db/bossQueries.ts`. Home shows `src/ui/BossCard.tsx` where `StrengthBody` was.

**Tech Stack:** React 19, TypeScript, Dexie (dexie-react-hooks), Tailwind v4, Vitest (fake-indexeddb), Playwright against the built app.

**Spec:** `docs/superpowers/specs/2026-11-12-boss-fight-design.md`

## Global Constraints

- British English, kilograms only, dark only; copy states facts, no tips.
- Every weight comes from the owner's own sets and plan; nothing from a model.
- Set size is the Level's: `weight × (1 + reps ÷ 30)`; "beats" means bigger by more than `1e-9`.
- Counted sets: `countsForRecords(type)`, reps ≥ 1, in a session where `sessionCountsForRecords(session)` (not a light quick one). Coach-filled sessions count.
- Weeks are Monday to Sunday by local date key (`mondayOf` in `src/domain/dates.ts`).
- Nothing written over a robot render; the plaque is `Card framed`; section heads are `SectionTitle`.
- Build the Ponytail way: reuse `GameMarks.tsx` (`Segments`, `Medallion`, `HexPanel`/`LevelUpPanel`), `ExerciseHero`, `nextSessionPlan`, Home's `start`.
- Before pushing: `npm run typecheck`, `npx vitest run`, `npm run build`, `npx playwright test --trace off`, all green, `retries: 0`.

## Review Focus

1. A set that beat the boss is deleted or edited down: the boss reads unbeaten again and its health goes back up (Task 2 test `un-beats when the beating set is deleted`).
2. Home's pick runs twice at once (two effects, a fast remount): exactly one row for the week (Task 2 test `picks once when two picks race`).
3. Monday arrives: last week's boss is no longer live, a new one is picked, last week's win stays in the row (Task 2 test `a new week picks a new boss and keeps last week's win`).
4. The boss's lift leaves every routine mid-week, or its exercise is deleted: the boss stays without attack or Fight; a deleted exercise's boss is not shown (Task 2 test `keeps the boss without an attack when its lift leaves the routines`).
5. A set logged in a session still open beats the boss; a set in a light quick session does not (Task 2 test `counts a live session, not a light quick one`).

---

### Task 1: The rules (pure domain)

**Files:**
- Modify: `src/domain/level.ts` (export the size and the comparison it already uses)
- Create: `src/domain/boss.ts`
- Test: `src/domain/boss.test.ts`

**Interfaces:**
- Produces, in `src/domain/level.ts`:
  - `setSize(weight: number, reps: number): number` = `weight * (1 + reps / 30)`
  - `bigger(a: number, b: number): boolean` = `a > b + 1e-9`
  - `levelFor` uses both (no behaviour change; `level.test.ts` stays green).
- Produces, in `src/domain/boss.ts`:
  - `interface BossSet { weight: number; reps: number }`
  - `interface PlanAt { routineId: string; routineName: string; weight: number; repMin: number; repMax: number }`
  - `interface Candidate { exerciseId: string; name: string; best: BossSet; plan: PlanAt }`
  - `attackFor(best: BossSet, plan: Pick<PlanAt, 'weight' | 'repMin' | 'repMax'>): BossSet | null` — fewest reps in `repMin..repMax` at `plan.weight` whose size beats `best`; null if none.
  - `pickBoss(candidates: readonly Candidate[], bossedThisWeek: ReadonlySet<string>): Candidate | null` — skip bossed lifts and those with no attack; smallest `(size(attack) − size(best)) / size(best)`; ties by `name` A to Z.
  - `bossHealth(boss: BossSet, floorSize: number | null, weekBestSize: number | null, beaten: boolean): number` — integer percent: 0 when beaten; else with floor `f` = `floorSize` if not null and below the boss's size, else `0.9 × size(boss)`: 100 when `weekBestSize` is null or ≤ f; else `ceil(100 × (size(boss) − weekBestSize) / (size(boss) − f))`, never below 1.

- [ ] **Step 1: Write the failing tests** in `src/domain/boss.test.ts`:

```ts
it('attacks with the fewest reps in range that beat the boss', () => {
  // 85 × 5 is 99.17; at 82.5, × 6 is 99.0 (short), × 7 is 101.75.
  expect(attackFor({ weight: 85, reps: 5 }, { weight: 82.5, repMin: 6, repMax: 8 })).toEqual({ weight: 82.5, reps: 7 });
  expect(attackFor({ weight: 85, reps: 5 }, { weight: 70, repMin: 6, repMax: 8 })).toBeNull();
  // A tie is not a win: 90 × 10 and 100 × 6 are both a size of 120.
  expect(attackFor({ weight: 90, reps: 10 }, { weight: 100, repMin: 6, repMax: 6 })).toBeNull();
});
it('picks the hardest fight the plan still wins, by name on a tie, never a lift already bossed', () => {
  const c = (exerciseId: string, name: string, best: BossSet, weight: number): Candidate =>
    ({ exerciseId, name, best, plan: { routineId: 'r', routineName: 'R', weight, repMin: 6, repMax: 8 } });
  const bench = c('b', 'Bench', { weight: 85, reps: 5 }, 82.5); // 101.75 vs 99.17: +2.6%
  const squat = c('s', 'Squat', { weight: 100, reps: 5 }, 100); // 120 vs 116.67: +2.9%
  expect(pickBoss([squat, bench], new Set())!.exerciseId).toBe('b');
  expect(pickBoss([squat, bench], new Set(['b']))!.exerciseId).toBe('s');
  expect(pickBoss([c('z', 'Zed', bench.best, 82.5), c('a', 'Abs', bench.best, 82.5)], new Set())!.name).toBe('Abs');
  expect(pickBoss([c('x', 'X', { weight: 85, reps: 5 }, 60)], new Set())).toBeNull();
});
it('moves health only when a set gets closer, and never reads 0 unless beaten', () => {
  const boss = { weight: 100, reps: 5 }; // 116.67
  expect(bossHealth(boss, 110, null, false)).toBe(100);
  expect(bossHealth(boss, 110, 109, false)).toBe(100);
  expect(bossHealth(boss, 110, 113.33, false)).toBe(51); // (116.67 − 113.33) ÷ 6.67 = 50.0…% rounded up
  expect(bossHealth(boss, 110, 116.67, false)).toBe(1);
  expect(bossHealth(boss, null, 110, false)).toBe(58); // floor 105: (116.67 − 110) ÷ 11.67
  expect(bossHealth(boss, 120, 110, false)).toBe(58); // a floor not below the boss falls back to 90%
  expect(bossHealth(boss, 110, 120, true)).toBe(0);
});
```

- [ ] **Step 2: Run** `npx vitest run src/domain/boss.test.ts` — expect FAIL (module not found).
- [ ] **Step 3: Implement** `setSize`, `bigger` in `level.ts` (use them in `levelFor`), and `attackFor`, `pickBoss`, `bossHealth` in `boss.ts` per the Interfaces above.
- [ ] **Step 4: Run** `npx vitest run src/domain/boss.test.ts src/domain/level.test.ts` — expect PASS.
- [ ] **Step 5: Commit** `git commit -m "Boss: the rules (attack, pick, health)"` with the attribution trailer.

### Task 2: Storage and queries

**Files:**
- Modify: `src/domain/types.ts` (add `Boss`), `src/db/db.ts` (version 7, `TABLE_NAMES`), `src/db/backup.ts` (`BACKUP_VERSION = 7`, read and write `bosses`), `src/db/backup.test.ts` (round-trip includes a boss)
- Create: `src/db/bossQueries.ts`
- Test: `src/db/bossQueries.test.ts`

**Interfaces:**
- Consumes: Task 1's `setSize`, `bigger`, `attackFor`, `pickBoss`, `bossHealth`, `BossSet`, `Candidate`.
- Produces:
  - `interface Boss { id: string; week: string; exerciseId: string; weight: number; reps: number; appearedAt: string }` in `types.ts`.
  - Dexie: `this.version(7).stores({ bosses: 'id, week, &[week+exerciseId]' })`; `bosses!: EntityTable<Boss, 'id'>`; `'bosses'` appended to `TABLE_NAMES`.
  - `ensureBoss(today: string, settings: Settings): Promise<void>` — writes. When the week (`mondayOf(today)`) has no boss, or its latest (by `appearedAt`) is beaten, gathers candidates and adds `pickBoss`'s choice with `appearedAt = new Date().toISOString()`. A `ConstraintError` from the unique index is swallowed (another pick won).
  - `interface BossView { boss: Boss; exercise: Exercise; bestDate: string; health: number; beatenBy: BossSet | null; attack: (BossSet & { routine: Routine }) | null; short: BossSet | null }` — `short` is the plan's top set when the live plan no longer beats the boss.
  - `loadBoss(today: string, settings: Settings): Promise<BossView | null>` — read-only, for `useLiveQuery`: the week's latest boss whose exercise exists; null when none.
  - `bossesBeaten(): Promise<{ id: string; name: string; weight: number; reps: number }[]>` — every boss with a beating set, newest first.
  - `bossBeatenBy(setId: string): Promise<Boss | null>` — the boss this set is the first to beat (for the toast).
  - `sessionBosses(sessionId: string): Promise<{ name: string; weight: number; reps: number; by: BossSet }[]>` — bosses first beaten by a set in this session (for the summary).
- Candidates: current routines (`!archived && !quick`, by `order`); for each routine-exercise in `mode: 'normal'` on an exercise of kind `reps`, first routine wins; the exercise has a Level start (≥ `START_SESSIONS` sessions with a counted set); `best` = biggest counted set ever; `plan` from `nextSessionPlan(routineId, settings)` (its `prescription.weight`, `repMin`, `repMax`; skip a null weight).
- Beaten: the first counted set on `exerciseId`, in a session started at or after `appearedAt` and on or before that week's Sunday (any session, open or ended), whose size beats the boss.
- Floor: the biggest counted set of the lift's last session that started before `appearedAt`. Week best: the biggest counted set from `appearedAt` to Sunday.

- [ ] **Step 1: Write the failing tests** in `src/db/bossQueries.test.ts`, using `resetToSeed`, `startSession`, `logSet` and the `trained` helper pattern of `gameQueries.test.ts` (sessions of the seed's `Barbell Back Squat` in `Lower (Squat)`; set the rx to `mode: 'normal'`). Tests, each asserting exact values:
  - `picks nothing before a lift has its start` — two sessions: `ensureBoss` adds no row; `loadBoss` is null.
  - `picks the squat once its start is set, with the attack from the plan` — three sessions of 100 × 5, rx `currentWeight: 100, repMin: 6, repMax: 8`: one row `{ weight: 100, reps: 5 }`; `loadBoss` gives `health: 100`, `attack: { weight: <plan weight>, reps: <fewest reps> }` (read the prescribed weight from `nextSessionPlan` in the test and assert the reps from it), `beatenBy: null`.
  - `counts a live session, not a light quick one` — a light quick session with 100 × 8 leaves `beatenBy` null; an open session with 100 × 6 (120 > 116.67) sets `beatenBy: { weight: 100, reps: 6 }` and `health: 0`.
  - `un-beats when the beating set is deleted` — delete that set: `beatenBy` null, `health` back to its earlier value.
  - `picks once when two picks race` — `await Promise.all([ensureBoss(t, s), ensureBoss(t, s)])`: one row.
  - `brings the next boss after a win, never the same lift twice a week` — with a second lift at its start (the seed's `Romanian Deadlift (Barbell)`), beat the first: `ensureBoss` adds the second; beat the second: no third row; `loadBoss` shows the second, beaten.
  - `a new week picks a new boss and keeps last week's win` — `ensureBoss` with a date 7 days on: a new row for the new week; `bossesBeaten()` still lists last week's.
  - `keeps the boss without an attack when its lift leaves the routines` — archive the routine: `loadBoss` keeps the boss, `attack: null`; delete the exercise row: `loadBoss` null.
  - `names the set that beat the boss, once` — `bossBeatenBy(firstBeatingSetId)` is the boss; a later, bigger set gives null; `sessionBosses(sessionId)` lists it once.
- [ ] **Step 2: Run** `npx vitest run src/db/bossQueries.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** the schema, the backup changes and `bossQueries.ts` per the Interfaces. One read of `sessions`, `setLogs`, `routines`, `routineExercises`, `exercises` per call, as `gameQueries.readTables` does.
- [ ] **Step 4: Run** `npx vitest run src/db` — expect PASS, `backup.test.ts` included.
- [ ] **Step 5: Commit** `git commit -m "Boss: the stored boss and its queries"`.

### Task 3: Home, the set and the summary

**Files:**
- Create: `src/ui/BossCard.tsx`
- Modify: `src/screens/HomeScreen.tsx` (StrengthBody out, BossCard in, `ensureBoss` effect), `src/screens/session/ExerciseCard.tsx:430-436` (toast), `src/screens/SummaryScreen.tsx` (panel beside Level ups)
- Delete: `src/ui/StrengthBody.tsx`, `src/domain/strengthBody.ts`, `src/domain/strengthBody.test.ts`; in `src/ui/StrengthLine.tsx` make `liftTable` private again
- Test: `e2e/boss.spec.ts`; edit `e2e/levels.spec.ts` and `e2e/lift-standards.spec.ts` to drop the strength-figure checks

**Interfaces:**
- Consumes: Task 2's `ensureBoss`, `loadBoss`, `bossesBeaten`, `bossBeatenBy`, `sessionBosses`, `BossView`.
- Produces: `BossCard({ view, beaten, active, onFight }: { view: BossView | null; beaten: { id: string; name: string; weight: number; reps: number }[]; active: boolean; onFight: (r: Routine) => void })`.
- Test ids: `boss` (section), `boss-name`, `boss-best`, `boss-health` (the `Segments`, `aria-valuenow` = health), `boss-attack`, `boss-fight`, `boss-beaten` (the plaque's Beaten mark), `bosses-beaten` (row), `summary-boss`.
- Copy (exact): section "This week's boss"; best line `Best {w} kg × {r} · {d Month}`; attack `Your attack {w} kg × {r}` over the routine name; short `Your plan {w} kg × {r} falls short`; button `Fight`; mark `Beaten`; row head "Bosses beaten", medallion `{w} × {r}` over the exercise name; toast suffix ` · Boss beaten`; summary panel title "Boss beaten", detail `{name} · {w} kg × {r}`.

- [ ] **Step 1: Write the failing e2e** `e2e/boss.spec.ts`: `fresh(page)`; three sessions of the squat at 100 × 5 through the UI (the `startLower`/`toSummary`/`save` helpers of `levels.spec.ts`); on Home assert the whole `boss-name`, `boss-best`, `boss-attack` texts and `boss-health` `aria-valuenow` = `100`, with the sums in comments; the fourth session logs the attack set and the toast reads `Record · {attack} · Level {n} · Boss beaten` (the level part only if the set levels up; pin what the app says); the summary's `summary-boss` reads `Boss beatenBarbell Back Squat · {attack}`; Home shows `boss-beaten`, `bosses-beaten` reads `100 × 5Barbell Back Squat`, and `boss-fight` has count 0. Every assertion waits on text that only the new state can show.
- [ ] **Step 2: Run** `npm run build && npx playwright test e2e/boss.spec.ts --trace off` — expect FAIL.
- [ ] **Step 3: Implement** `BossCard` (framed plaque: `ExerciseHero` on top, else a brass hexagon with the boss weight; `Segments` for health; Fight as the cream primary `Button`, hidden while `active` or without an attack), the Home wiring (`useEffect(() => { if (settings) void ensureBoss(todayKey, settings) }, [todayKey, settings, game])`, `useLiveQuery` for `loadBoss` and `bossesBeaten`, `onFight={start}`), the toast suffix from `bossBeatenBy(newSet.id)`, and the summary panel from `sessionBosses(id)`.
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run && npm run build && npx playwright test e2e/boss.spec.ts e2e/levels.spec.ts e2e/lift-standards.spec.ts --trace off` — expect PASS.
- [ ] **Step 5: Screenshot** Home with a boss and with a beaten boss (a throwaway `e2e/zz-peek.spec.ts`, deleted after) and check: render clear of text, health bar legible, nothing clipped at 390 px.
- [ ] **Step 6: Commit** `git commit -m "Home: a weekly boss in place of the strength figure"`.

### Task 4: Docs and ship

**Files:**
- Modify: `CLAUDE.md` (the Level paragraph's strength-figure sentence becomes the boss: where it lives, the rules in one line, the one stored row), `docs/DESIGN.md` §6 Home line.

- [ ] **Step 1:** Edit both docs.
- [ ] **Step 2: Run** the full gate: `npm run typecheck && npx vitest run && npm run build && npx playwright test --trace off` — expect all green.
- [ ] **Step 3: Commit, push** to `claude/workout-logger-progression-rgm067`, wait for CI, check the artifact's sha, send the APK.
