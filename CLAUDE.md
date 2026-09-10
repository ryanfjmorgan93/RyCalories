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
- Pure domain logic first, with tests, before any UI that depends on it.

## Product rules that are part of correctness

- Kilograms only, British English, dark mode default, phone-first with big tap targets.
- **Nothing in this app lectures the user.** No tips, motivational copy, coaching prose or
  explanatory hand-holding. Empty states and warnings state a fact or offer an action, nothing more.
  The only prose in a session is the user's own exercise cue.
- Must work fully offline. The Open Food Facts label lookup is the only thing that leaves the
  device, and it is switchable off in Settings.
- Never show a number that flatters: no clamping an overage to zero, no average that silently
  counts unlogged days, no rounding that makes a column stop adding up.

## Layout

- `src/domain/` — pure functions, no IO, no clock, no database. Tested directly.
- `src/db/` — Dexie schema and every write. `todayQueries.ts` and `trendQueries.ts` are the
  cross-domain joins between training and nutrition.
- `src/screens/`, `src/ui/` — React. `e2e/` — Playwright against the built app.
- `docs/MERGE_PLAN.md` — what is done, what is left, and the traps already paid for.
