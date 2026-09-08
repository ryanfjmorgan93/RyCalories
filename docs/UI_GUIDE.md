# Iron — UI and code conventions

Read this before adding or editing a screen. Match it exactly so the app reads as one piece.

## Product rules (non-negotiable)
- **British English**, kilograms only. "Calibrating", "Programme" is not used; say "routine".
- **No lecturing.** No tips, motivational copy, "did you know", coaching prose, emojis. Labels are short nouns/verbs. The only mid-session prose is the user's own cue.
- **Phone-first, one-handed, sweaty hands.** Minimum tap target 44 px (`min-h-14` rows, `h-12`+ buttons). Big numbers (`num` class, `font-extrabold`). Minimal chrome.
- **Dark by default.** Use only the palette tokens below; never hard-code colours.
- **Offline-first.** No network calls. All data via Dexie (`src/db/db.ts`) and the repo layer (`src/db/repo.ts`).

## Palette tokens (Tailwind classes)
`bg-bg` page · `bg-surface` cards · `bg-surface-2` inputs/inset · `border-line` · `text-fg` · `text-muted` · `text-dim`
`accent` (orange, primary actions / cue text) · `ok` (green, done / increase) · `warn` (amber, stall / warm-up) · `danger` (red) · `info` (blue, calibrating).
Foreground pairs: `text-accent-fg` on `bg-accent`, `text-ok-fg` on `bg-ok`, `text-bg` on `bg-fg`/`bg-warn`/`bg-danger`.

## Primitives (`src/ui/components`)
- `Button` — `variant`: primary | secondary (default) | outline | ghost | danger | ok; `size`: sm | md | lg | xl; `full`. `IconButton` for 44 px icon targets.
- `Card`, `SectionTitle` (uppercase tracking label with optional `right` slot), `Row` (list row: `title`, `subtitle`, `left`, `right`, `onClick`, `dim`), `Divider`, `EmptyState`, `Stat` (label + big value).
- `Sheet` (bottom sheet: `open`, `onClose`, `title`, `footer`) and `Confirm` (two-button sheet, `danger` for destructive).
- `NumberField` (big −/+ stepper with numeric keyboard: `value: number|null`, `onChange`, `step`, `min`, `max`, `label`, `unit`, `mode: 'decimal'|'numeric'`), `NumberInput` (plain numeric input), `TextInput` (`multiline`).
- `Chip` (`active`, `tone`, `size`, `onClick`), `Segmented` (radio group), `Toggle` (switch row with label/sub).
- `TopBar` (`title`, `subtitle`, `back` (true or a path), `right`) plus icons: `ChevronIcon`, `PlusIcon`, `CheckIcon`, `MoreIcon`, `TrashIcon`, `DragIcon`, `BackIcon`.
- `LineChart` (SVG: `points: {t, y}[]`, optional `secondary`, `band {min,max}`, `unit`, `height`).
- `toast(message, tone?)` from `Toast.tsx` for brief confirmations.
- `ExercisePicker` (`src/ui/ExercisePicker.tsx`) — searchable sheet returning an `Exercise`.

## Layout pattern
```tsx
<div>
  <TopBar title="Routines" right={<IconButton label="Add" onClick={…}><PlusIcon/></IconButton>} />
  <div className="px-4">
    <SectionTitle>…</SectionTitle>
    <Card>…rows separated by <Divider/>…</Card>
    <div className="h-6" />
  </div>
</div>
```
Screens inside the tab shell already get bottom padding for the nav (`pb-safe-nav`). Session screens use `pb-safe-timer`.

## Data access
- Read with `useLiveQuery` (dexie-react-hooks) or the hooks in `src/ui/hooks.ts` (`useSettings`, `useRoutines`, `useRoutineItems`, `useExercises`, `useExercise`, `useActiveSession`, `useSession`, `useRecentSessions`, `useNow`).
- Write only through `src/db/repo.ts` functions (create/update/delete/reorder routines and routine-exercises, `lockInRoutineExercise`, `unlockRoutineExercise`, `createExercise`, `updateExercise`, `deleteExercise`, `exerciseUsage`, `exerciseHistory`, `sessionDetail`, `deleteSession`, `decisionsForRoutineExercise`, `stallStatus`, `logBodyweight`, `deleteBodyweight`, `saveSettings`, `resetToSeed`, `wipeAll`).
- Backup/CSV: `src/db/backup.ts` (`exportBackup`, `importBackup`, `exportCsv`, `exportBodyweightCsv`, `deliverFile`, `backupFilename`, `csvFilename`, `isBackup`).
- Hevy import: `src/db/hevy.ts` (`parseHevyCsv`, `planHevyImport`, `runHevyImport`, `reconcileWeights`, `applyReconciledWeights`).
- Domain helpers: `src/domain/format.ts` (`fmtKg`, `fmtNum`, `fmtWeight(kind, n)`, `fmtRange`, `fmtDuration`, `fmtMinutes`, `fmtDate`, `fmtDateTime`, `fmtDateLong`, `targetLine(rx, kind)`, `decisionLine`), `src/domain/dates.ts`, `src/domain/bodyweight.ts`, `src/domain/nutrition.ts`, `src/domain/schedule.ts`, `src/domain/engine.ts` (pure; do not put IO in it).
- Types: `src/domain/types.ts`. Progression fields (`currentWeight`, `mode`, `increment`, rep range, `cue`, `optional`, `restSecOverride`, `targetSetsMax`, `distanceMinM/MaxM`) live on `RoutineExercise`, not `Exercise`.

## Behaviour conventions
- Destructive actions (delete routine/exercise/session/reading, reset, replace-restore) go through `Confirm` with `danger`.
- Saving forms: save on explicit tap (a `primary` button) unless the screen is a toggle list, where changes persist immediately and show a `toast`.
- Numbers: use `NumberField` for values the user adjusts in the gym; `NumberInput` in forms.
- Empty states: one short line in `EmptyState`.
- Never block the UI on IndexedDB; render `Loading…` text only while the first query is undefined.
- Keep every string plain and short. Sentence case. No exclamation marks.
