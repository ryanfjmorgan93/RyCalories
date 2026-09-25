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

- Kilograms only, British English, dark mode default, phone-first with big tap targets.
- **Nothing in this app lectures the user.** No tips, motivational copy, coaching prose or
  explanatory hand-holding. Empty states and warnings state a fact or offer an action, nothing more.
  The only prose in a session is the user's own exercise cue. One exception, by the owner's own
  request (September 2026): the streak line on the Home and Progress calendars may carry one short
  sentence of encouragement, chosen deterministically by streak length from the fixed list in
  `src/domain/calendar.ts`. Never a toast, never a notification, nowhere else. The assistant box
  answers only what the user asked and never opens itself. The technique text in
  `src/data/exerciseInstructions.json` (including its "Tip:" lines) is a second, narrower
  carve-out the owner confirmed in September 2026: it is third-party dataset content rather than
  copy this app wrote, and in a session it appears only behind a "How to" the user taps open.
  Leave it alone; it is not an oversight.
- Must work fully offline. Three things leave the device, all listed in Settings → About: the
  Open Food Facts label lookup (switchable off; the barcode scan is the same lookup), the Video link
  on an exercise (a user tap that opens the browser), and Google's ML Kit usage statistics while the
  on-device assistant runs (the model itself runs on the phone through AICore). Nothing else.
- Never show a number that flatters: no clamping an overage to zero, no average that silently
  counts unlogged days, no rounding that makes a column stop adding up.

## Layout

- `src/domain/` — pure functions, no IO, no clock, no database. Tested directly. `sets.ts` is the
  one place that says what each set type counts for; `engine.ts` decides; `prescription.ts`,
  `records.ts`, `strength.ts`, `volume.ts`, `calendar.ts`, `plates.ts`, `warmup.ts` are the
  progressive-overload maths.
  `claudeSummary.ts`, `routineText.ts` and `exerciseMatch.ts` are the Claude bridge: a text
  summary the owner copies into their own Claude app, and a pasted reply read back as routines.
  The app never calls Claude; Copy and Share hand text to the OS and send nothing themselves.
  `coach.ts` is the coach: which of the owner's data a question reads, fitted to the on-device
  model's token limit. It runs on the same AICore Nano (the fuller variant), so nothing new
  leaves the device.
  `recipe.ts`, `mealAnalysis.ts`, `mealText.ts` and `ingredientMatch.ts` are cooked meals: the
  AI only names ingredients (on the phone, from a photo); amounts come from the user and figures
  from a scanned pack, a food logged before, or the bundled UK table — never from the model.
- `src/data/ukFoodTable.json` and `ukFoodAliases.json` are CoFID 2021 (Open Government Licence),
  generated by hand with `scripts/uk-food-table.py` and committed; per-item weights (one egg, one
  rasher) are the app's own estimates, shown with "≈" and editable. Lazy-loaded by the recipe
  builder only.
- `src/data/exerciseDemos.ts` is generated by `scripts/exercise-media.mjs` (run on every build);
  the frames it points at are gitignored and rebuilt from the `@bryllim/workout-guide` package.
- `android/app/src/main/java/.../NanoPlugin.java` is the only native code: Gemini Nano through ML
  Kit's GenAI Prompt API, Java only, compiled by CI. It cannot be exercised in the sandbox; the
  Settings → Assistant card's status and Test button are how the owner checks it on the phone.
- `src/db/` — Dexie schema and every write. `todayQueries.ts` and `trendQueries.ts` are the
  cross-domain joins between training and nutrition.
- `src/screens/`, `src/ui/` — React. `e2e/` — Playwright against the built app.
- `docs/MERGE_PLAN.md` — what is done, what is left, and the traps already paid for.
