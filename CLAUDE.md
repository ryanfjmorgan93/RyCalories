# Working on this repo

## Subagent models — Sonnet by default

**Every subagent runs on Sonnet unless there is a stated reason it cannot.** Opus subagents burn
the owner's credits for work that does not need them.

- In `Workflow` scripts, pass `model: 'sonnet'` on every `agent()` call.
- With the `Agent` tool, pass `model: 'sonnet'`.
- The main session stays on Opus. Reviewing, judging findings and deciding what to act on is the
  Opus-level job; fanning out to read files, run tests and draft findings is not.
- Escalating a specific agent to Opus needs a reason worth saying out loud — say it when you do it,
  do not do it by default.

## Skills

`.claude/skills/ponytail*` is Ponytail 5.2.0 (DietrichGebert/ponytail, MIT), copied by hand at the
owner's request without its hooks: the smallest complete change, `/ponytail-review`,
`/ponytail-audit`, `/ponytail-debt`. Where it differs from this file, this file wins.

**Build the Ponytail way by default** (the owner asked, October 2026: "much simpler moving
forward"). Load the `ponytail` skill before writing code: the smallest change that fully works,
reuse what the repo has, no abstraction or option nobody asked for. The tests and product rules
above still apply in full.

The other folders under `.claude/skills/` are Matt Pocock's skills 1.3.2 (mattpocock/skills at
4ae2317, MIT, licence in `.claude/skills/MATTPOCOCK-SKILLS-LICENSE`), copied by hand at the
owner's request in November 2026 for thinking a feature through before it is built: `/grill-me`
and `/grill-with-docs` (the interview), `/prototype`, `/research`, `/to-spec`, `/to-tickets`,
`/tdd` and the rest. `code-review` was left out because the harness has its own `/code-review`.
Where they differ from this file, this file wins: what they call `GLOSSARY.md` is `CONTEXT.md`
here, building is still the Ponytail way, and any subagent they start runs on Sonnet.
`/setup-matt-pocock-skills` has not been run, so the ticket skills (`/to-spec`, `/to-tickets`,
`/triage`) have no issue tracker yet.

## Verification

The owner does not check on device. Correctness has to come from the code and the tests.

- `npm test` (Vitest) and `npx playwright test` both gate CI before the APK is built.
- A test that passes because it mocked the thing under test has proved nothing. This has already
  shipped twice on this branch: a service worker serving a stale bundle, and a label lookup that was
  blocked by CORS in every browser while its test intercepted the request. Prefer a test that
  exercises the real path, and say so plainly when one cannot.
- **An assertion that can pass before the thing it guards has happened has proved nothing either.**
  `toHaveValue` / `toBeVisible` pass on the first poll that matches, so "do an async thing, then
  assert nothing changed" passes instantly and is a coin-flip. Nor may a wait rest on a signal a
  previous occurrence could satisfy — a toast lives 2200 ms and repeats verbatim. Nor may an
  assertion sample state once without retrying (`getAttribute('class')`); use `expectClass` in
  `e2e/fresh.ts`. Each of these three hid a real failure on this branch; the first hid a live data
  bug for days behind a green CI tick.
- CI runs `retries: 0`. Playwright reports "failed once, passed on retry" as a plain success, which
  made a flake invisible in the one place it mattered. A flake goes red and gets fixed.
- Run the suite against the browser CI runs — leave `executablePath` unset so Playwright uses its
  own build (`npx playwright install chromium chromium-headless-shell`). The pinned sandbox binary
  is twelve major Chromium versions behind and local and CI disagreed on real tests because of it.
- Pure domain logic first, with tests, before any UI that depends on it.

## Product rules that are part of correctness

- Kilograms only, British English, dark only (the light theme was removed at the owner's request,
  October 2026), phone-first with big tap targets. The look is the owner's pick of November 2026
  (docs/DESIGN.md): warm black, cream, brass by default, Space Grotesk.
- **The coach may speak first; nothing else lectures.** Since October 2026 (docs/adr/0002) the
  coach (Claude) speaks at defined moments (CONTEXT.md: Moment) like a good personal trainer:
  to the point, encouraging, the odd motivational line, now and then asking how the owner is
  doing. It says nothing when it has nothing useful, and nothing at all offline, without a key or
  over the spend cap. The rest of the app's copy still states facts and offers actions, with no
  tips or hand-holding. The streak is dots and a count (its fixed sentences were removed at the
  owner's request, October 2026); Home's welcome and quote of the day (`src/domain/dailyQuote.ts`, a fixed bundled list, added
  at the owner's request in October 2026) stay. The
  technique text in `src/data/exerciseInstructions.json` and `exerciseCatalogueSteps.json` is
  third-party dataset content shown only behind a "How to" tap; leave it alone. Phone
  notifications are deterministic and limited to the food reminder, the training nudge, the
  Monday weigh-in and the daily supplement checklist (`src/domain/reminders.ts`).
- Tracking must work fully offline. Four things leave the device, all listed in Settings → About:
  Android's Google backup of the database (about once a day, when Google backup is on in the
  phone's settings; `android/app/src/main/res/xml/data_extraction_rules.xml` includes the WebView's
  `app_webview/` and excludes its Local Storage, where the Claude key lives, guarded by
  `src/db/manifest.test.ts`; it restores only into an APK signed with the committed keystore),
  Claude API calls (only with the owner's key: what they send the coach, a summary of their
  training, food, supplements and steps, and photos they choose; the chat's web search runs on
  Anthropic's side, and a cited source opens in the browser only on a tap), the Open Food Facts label lookup
  (switchable off; the barcode scan is the same lookup), and the Video link on an exercise (a user
  tap that opens the browser). Nothing else. Steps, and bodyweight when the owner turns it on, are
  read on the phone from Health Connect (read only, write nothing; every other health permission
  the plugin declares is removed in the manifest). Steps are never stored; a weight read in is
  stored as a bodyweight entry marked `source: 'health-connect'`, only for a day with no reading of
  the owner's own, and never again for a day they deleted. Problem reports (the coach's
  report_problem tool, a coach reply that failed for a reason the app has no words for, and errors nothing caught in the APK) stay on the phone until the owner
  shares them from Settings; the Claude key is scrubbed from every report.
- The Claude key lives only in `localStorage` (`src/ai/key.ts`), never in the Settings row, a
  backup, a CSV or a log (docs/adr/0003). Spending is capped in the app (`src/ai/spend.ts`).
- Claude's figures are estimates (docs/adr/0004): stored with the `model` source, shown with ≈,
  never overwriting a figure from the owner, a label or the UK table. Training weights come only
  from the owner's own numbers, never from a model.
- Never show a number that flatters: no clamping an overage to zero, no average that silently
  counts unlogged days, no rounding that makes a column stop adding up.

## Layout

- `src/domain/` — pure functions, no IO, no clock, no database. Tested directly. `sets.ts` is the
  one place that says what each set type counts for (only working sets are logged now; warm-up,
  failure and drop rows survive in old data); `engine.ts` decides, using the effort chip at the top
  of the rep range, and progresses from what was lifted: when a session's sets were at different
  weights, from the heaviest done for at least the bottom of the range, never from a prescription
  already outlifted; `prescription.ts`, `records.ts`, `strength.ts`, `volume.ts`, `calendar.ts` and
  `plates.ts` are the progressive-overload maths.
  `planOverride.ts` is today's plan for one exercise (a plan override); `routineOrder.ts` orders
  routines by how long their regions have rested.
  `claudeSummary.ts` builds the text summary of the owner's training and food that the coach's
  context reuses. `routineText.ts` and `exerciseMatch.ts` read a routine written as text (the
  review before a drafted routine is saved).
  `usualMeals.ts` is the usual meals Food offers for the time of day (asked for in November 2026):
  the ones the owner saved (kept in the Settings row) and the ones their own history shows, logged
  in one tap; the Food day leads with calories and protein left and lists each meal's foods. A food
  eaten before is one tap from the Add food list at its usual amount (`usualAmount` in
  `foodChoice.ts`), the sheet staying open for the next. A meal Claude read from a photo or a sentence is listed
  food by food and stays until Keep, Undo or Adjust is tapped (it is on the day already).
  `recipe.ts`, `mealText.ts`, `ingredientMatch.ts`, `foodUnits.ts` and `foodChoice.ts` are food:
  natural units, matching to remembered foods and the UK table, and the one item shape every way of
  logging produces.
  `inbody.ts` reads body-scan exports; `goalTargets.ts` is the daily calories and macros from the
  owner's goal (lean gain, faster gain, recomp, fat loss; Settings → Targets): maintenance measured
  (energy.ts: food eaten against weight change, the sum shown with the owner's numbers) when its
  gates pass, else the scan's BMR × 1.35 plus walking and the lifting actually logged in 4 weeks,
  with what the measured figure still needs; the goal's
  rate as % of bodyweight a week; protein, fat and carbs from published ranges, each figure with
  the sum it came from. `state/goalTargets.ts` saves them at start-up, after a scan and on a goal
  change. There is no reverse-diet stepping any more (the owner refused it, November 2026): a
  calorie target is one figure, held. `reminders.ts` plans the local notifications.
  `supplements.ts` is the daily supplement checklist; `dailyQuote.ts` is Home's welcome and quote.
  `healthWeight.ts` picks the bodyweight readings to read in from Health Connect (each day's first,
  never over the owner's own); `problemReports.ts` is what a problem report holds and the text it
  is shared as.
  `steps.ts` turns Health Connect's raw step records into daily totals: per day the largest single
  source, never the sum across apps (a phone and a watch count the same walk), and the week
  averaged over recorded days only.
  `energy.ts` is the maintenance estimate (with `energyText.ts` for its wording): intake over
  logged days only, weight change between week-means, three gates, shown with its counts or not at
  all.
  `quickRequest.ts`, `quickSession.ts`, `quickDraft.ts` and `quickInput.ts` are the short session:
  a typed request read by rules, and a seeded generator that builds 30 to 45 minutes from the
  owner's own exercises, recency and weights. Every weight comes from the owner's numbers, never
  from a model. The sheet's other half is My own (asked for in November 2026): the owner picks the
  exercises, and `ownQuickPlan` makes exactly those, in their order, into the same kind of plan by
  the same row rule, so Start is the one `startQuickSession`. A carry or a hold is only ever there
  by their pick (walks at a load, seconds for a hold; the generator still draws neither). `catalogue.ts` holds the extra exercises
  that sit beside the database: they become a row only when added or used.
- `src/data/exerciseCatalogue.json`, `exerciseCatalogueSteps.json` and `assets/catalogue-frames/`
  are free-exercise-db (Unlicense) and are generated by hand with
  `scripts/build-exercise-catalogue.mjs`, committed, never built in CI. The index and the steps are
  lazy-loaded; `scripts/exercise-media.mjs` copies the frames to the gitignored `public/catalogue/`.
- `src/data/ukFoodTable.json` and `ukFoodAliases.json` are CoFID 2021 (Open Government Licence),
  generated by hand with `scripts/uk-food-table.py` and committed; per-item weights (one egg, one
  rasher) are the app's own estimates, shown with "≈" and editable. Lazy-loaded by the Add food
  search and the recipe builder.
- `src/data/liftStandards.json` is OpenPowerlifting (public domain): raw meet bests as percentiles
  per sex, age group and IPF weight class, generated by hand with `scripts/lift-standards.py`,
  committed, lazy-loaded by a lift in a session (`ui/StrengthLine.tsx`). `src/domain/standards.ts`
  names the level under a squat, bench or deadlift in a session: the published bands of Santos
  Junior et al. 2021 (1RM as % of bodyweight, per sex), then, above highly advanced, the average
  (median) and top 1% raw competition powerlifter of the owner's sex, age group and class (`liftStandards.ts`; Settings →
  About you: year of birth and sex). Body fat plays no part: meets record bodyweight only.
- `src/domain/level.ts` is the Level under every exercise in a session (`ui/LevelLine.tsx`; asked
  for in November 2026, "I wanna feel like this app is a game"): the owner's best set against the
  best of their first three sessions, 5% a level, a set sized as weight × (1 + reps ÷ 30) so it
  holds past 12 reps. Derived from the sets, never stored; a level-up is said at the set and on the
  summary. It compares the owner only with themselves: no open table ranks a row, a raise or a
  machine (one gym's stack is not another's), and Strength Level's numbers may not be used in an
  app without a licence, so no rank against other people is shown beyond squat, bench and deadlift.
  The line under a lift names the set that reaches the next level at today's working weight
  ("Level 3 at 75 kg × 7"), counted by the same sum as the level. On Home
  (`ui/LevelsCard.tsx`, read by `db/gameQueries.ts` in one pass over the tables) every level above 1
  is added into a total level in a hexagon, today's hand is the three lifts of the current routines
  nearest their next level as cards, and the cabinet opens the badges; a Level up panel stands on
  the session card and the summary (`ui/GameMarks.tsx`, docs/DESIGN.md §6). `src/domain/badges.ts` is the badge ladders (asked for in November
  2026): sessions finished, tonnes lifted, the total level, and for a barbell lift its heaviest
  counted set in 20 kg steps from 60 kg. A badge is read off the data, never stored, so it follows
  an edit or a delete; what is left to the next is rounded up. The summary lists the badges a
  session added and what it did to the total level, read as the data stood around that session.
  Food has two ladders once a day is logged: days logged and days the protein target was hit
  (`foodDays` in `db/gameQueries.ts`), counted as days, never a streak; the Food day shows a
  Protein hit panel on a day that reached it.
- The app icon is `assets/app-icon/plate.svg` (an ember plate, the owner's pick, November 2026),
  rendered by hand with `scripts/app-icon.mjs` into the Android mipmaps and `public/icons/`, and
  committed. The foreground layer is also the splash screen's icon; the tile behind it is
  `res/drawable/ic_launcher_background.xml`. `src/db/manifest.test.ts` checks the wiring and sizes.
- `src/data/exerciseDemos.ts` is generated by `scripts/exercise-media.mjs` (run on every build);
  the frames it points at are gitignored and rebuilt from the `@bryllim/workout-guide` package.
- `src/ai/` — the coach: Claude through `@anthropic-ai/sdk` (key, spend cap, context, persona,
  tools, chat, moments, photo and label readers). Sonnet for everything, coach lines included (the
  owner found Haiku's lines dumb, October 2026); chat at medium effort; never Opus. Tests never call the real API: unit tests use
  `src/test/fakeClaude.ts`, e2e intercepts `api.anthropic.com` with `page.route`. The routine and
  session tools reach the whole exercise library by name (`findExerciseAnywhere` in
  `src/db/catalogueRepo.ts`, the paste matcher's rules); with no review step, a library entry is
  taken only when the name says exactly it, and a looser guess is named back, never added.
  Chat carries Anthropic's web search (`web_search`, direct, at most 3 a request, $0.01 each in
  `prices.ts`) for a chain's or brand's own nutrition figures; the pages it cites are stored on the
  reply and shown under it, as Anthropic requires. `recordActions.ts` is the coach's hands on what is
  already logged, through the same data code as the screens: `find_entries` (a day's food, weigh-in
  or sessions, with short ids), `edit_food`, `edit_training`, `delete_weight` and `change_setting`;
  it may replace only its own estimates' figures. `controlActions.ts` runs the rest when asked:
  the supplement checklist, whole routines (rename, delete, restore, copy), recipes (log a share,
  delete), phone reminders, and the session (start it, open its finish screen, discard it); a
  delete takes the exact name, never a near one. Starting or finishing hands back a screen to open
  (`open`), which CoachSheetHost goes to; next time's weights are still chosen on the summary.
  Calorie and protein targets set on request go through `domain/targetChange.ts`, as the offer's
  tap does. Only the first eleven tools are strict: a
  twelfth strict schema made every chat fail in build 127, so every tool added since is not.
  `log_past_session` fills in a workout trained but not logged (the last 7 days): the owner's own
  sets, or their routine "as planned" at the bottom of each rep range. It is stored with
  `source: 'coach'`, shown as "Filled in" with no made-up time, and writes no weight decision.
- `src/platform/` — share-sheet import (InBody files), local reminders, steps and weight from
  Health Connect (`health.ts`, through `@capgo/capacitor-health`), and the capture of uncaught
  errors as problem reports, in the APK only (`errorReports.ts`). There is no custom native code; plugins
  come from npm and `npx cap sync` wires them. A browser has no Health Connect, so no test reaches
  the live read: the wrapper and the store are tested with the plugin faked, e2e covers the
  "not here" state and the goal.
- `src/db/` — Dexie schema and every write. `todayQueries.ts` and `trendQueries.ts` are the
  cross-domain joins between training and nutrition.
- `src/screens/`, `src/ui/` — React. `e2e/` — Playwright against the built app.
- `docs/MERGE_PLAN.md` — what is done, what is left, and the traps already paid for.
