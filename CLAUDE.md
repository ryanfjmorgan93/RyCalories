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
  October 2026), phone-first with big tap targets.
- **The coach may speak first; nothing else lectures.** Since October 2026 (docs/adr/0002) the
  coach (Claude) speaks at defined moments (CONTEXT.md: Moment) like a good personal trainer:
  to the point, encouraging, the odd motivational line, now and then asking how the owner is
  doing. It says nothing when it has nothing useful, and nothing at all offline, without a key or
  over the spend cap. The rest of the app's copy still states facts and offers actions, with no
  tips or hand-holding; the streak line's fixed sentences in `src/domain/calendar.ts` remain, and so
  does Home's welcome and quote of the day (`src/domain/dailyQuote.ts`, a fixed bundled list, added
  at the owner's request in October 2026). The
  technique text in `src/data/exerciseInstructions.json` and `exerciseCatalogueSteps.json` is
  third-party dataset content shown only behind a "How to" tap; leave it alone. Phone
  notifications are deterministic and limited to the food reminder, the training nudge, the
  Monday weigh-in and the daily supplement checklist (`src/domain/reminders.ts`).
- Tracking must work fully offline. Three things leave the device, all listed in Settings → About:
  Claude API calls (only with the owner's key: what they send the coach, a summary of their
  training, food, supplements and steps, and photos they choose), the Open Food Facts label lookup
  (switchable off; the barcode scan is the same lookup), and the Video link on an exercise (a user
  tap that opens the browser). Nothing else. Steps, and bodyweight when the owner turns it on, are
  read on the phone from Health Connect (read only, write nothing; every other health permission
  the plugin declares is removed in the manifest). Steps are never stored; a weight read in is
  stored as a bodyweight entry marked `source: 'health-connect'`, only for a day with no reading of
  the owner's own, and never again for a day they deleted. Problem reports (the coach's
  report_problem tool, and errors nothing caught in the APK) stay on the phone until the owner
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
  `recipe.ts`, `mealText.ts`, `ingredientMatch.ts`, `foodUnits.ts` and `foodChoice.ts` are food:
  natural units, matching to remembered foods and the UK table, and the one item shape every way of
  logging produces.
  `inbody.ts` reads body-scan exports; `reminders.ts` plans the local notifications.
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
  from a model. `catalogue.ts` holds the extra exercises
  that sit beside the database: they become a row only when added or used.
- `src/data/exerciseCatalogue.json`, `exerciseCatalogueSteps.json` and `assets/catalogue-frames/`
  are free-exercise-db (Unlicense) and are generated by hand with
  `scripts/build-exercise-catalogue.mjs`, committed, never built in CI. The index and the steps are
  lazy-loaded; `scripts/exercise-media.mjs` copies the frames to the gitignored `public/catalogue/`.
- `src/data/ukFoodTable.json` and `ukFoodAliases.json` are CoFID 2021 (Open Government Licence),
  generated by hand with `scripts/uk-food-table.py` and committed; per-item weights (one egg, one
  rasher) are the app's own estimates, shown with "≈" and editable. Lazy-loaded by the Add food
  search and the recipe builder.
- `src/data/exerciseDemos.ts` is generated by `scripts/exercise-media.mjs` (run on every build);
  the frames it points at are gitignored and rebuilt from the `@bryllim/workout-guide` package.
- `src/ai/` — the coach: Claude through `@anthropic-ai/sdk` (key, spend cap, context, persona,
  tools, chat, moments, photo and label readers). Sonnet for conversation, tools and photos; Haiku
  for coach lines; never Opus. Tests never call the real API: unit tests use
  `src/test/fakeClaude.ts`, e2e intercepts `api.anthropic.com` with `page.route`. The routine and
  session tools reach the whole exercise library by name (`findExerciseAnywhere` in
  `src/db/catalogueRepo.ts`, the paste matcher's rules); with no review step, a library entry is
  taken only when the name says exactly it, and a looser guess is named back, never added.
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
