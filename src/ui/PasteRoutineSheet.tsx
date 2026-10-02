import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepsNumbers, kindOfChoice, saveParsedRoutines, type ImportChoice, type ImportRow } from '@/db/routineImport';
import { matchExercise, normaliseName, type ExerciseMatch } from '@/domain/exerciseMatch';
import { fmtNum, fmtRange } from '@/domain/format';
import { candidatesFromRows, findExistingExercise, type ExerciseListRow } from '@/domain/library';
import { parseRoutineText, type ParsedRoutineLine } from '@/domain/routineText';
import { Button } from './components/Button';
import { Card, Divider } from './components/Card';
import { TextInput } from './components/NumberField';
import { Sheet } from './components/Sheet';
import { toast } from './components/Toast';
import { ExercisePicker } from './ExercisePicker';
import { LibraryLabel } from './LibraryLabel';
import { useLibrary } from './useLibrary';

/** What choosing a list row means for a pasted line: the exercise itself, or the library entry it will be made from on Save. */
function choiceFor(row: ExerciseListRow): ImportChoice {
  if (row.exercise) return { kind: 'existing', exerciseId: row.exercise.id };
  return row.entry ? { kind: 'catalogue', entry: row.entry } : { kind: 'demo', demo: row.demo! };
}

/** "4 × 6–8 · 80 kg", "3 × 30–60 s", or what is missing. */
function prescription(line: ParsedRoutineLine): string {
  const parts: string[] = [];
  if (line.sets !== undefined && line.repMin !== undefined) {
    parts.push(`${fmtNum(line.sets)} × ${fmtRange(line.repMin, line.repMax ?? line.repMin, line.seconds ? 's' : '')}`);
  } else if (line.sets !== undefined) {
    parts.push(`${fmtNum(line.sets)} sets`);
  } else {
    parts.push('Sets not given');
  }
  if (line.weightKg !== undefined) parts.push(`${fmtNum(line.weightKg)} kg`);
  return parts.join(' · ');
}

function rowKey(ri: number, ei: number, line: ParsedRoutineLine): string {
  return `${ri}:${ei}:${line.raw}`;
}

/**
 * Paste a routine someone (or Claude) wrote; each exercise is matched to the owner's exercises and
 * the library (theirs win a tie), anything it is not sure of waits for a choice, and nothing is
 * saved until Save. A line matched to a library entry is marked Library and the exercise is made
 * when the routine is saved, so a paste that is cancelled adds nothing.
 *
 * A routine the app built itself comes with `preMatched`: it already knows which exercise each of
 * its rows is, so those lines are not matched by name at all.
 */
export function PasteRoutineSheet({
  open,
  onClose,
  initialText,
  preMatched,
  title = 'Paste a routine',
}: {
  open: boolean;
  onClose: () => void;
  /** Text to start from — the coach's drafted routine — instead of an empty box. */
  initialText?: string;
  /**
   * What the lines of `initialText` are, by name (`normaliseName`): the exercise-list key of each
   * line of that name in the order they are written (`builtRowKeys`). A line named here is that
   * exercise, never a match from its name; a line that is not, or that the owner has since chosen
   * another exercise for, is read as pasted text is.
   */
  preMatched?: ReadonlyMap<string, readonly string[]>;
  title?: string;
}) {
  const nav = useNavigate();
  const { rows: listRows, exercises } = useLibrary(open);
  const [text, setText] = useState(initialText ?? '');
  // Each time the sheet opens on a different draft, start from that draft.
  useEffect(() => {
    if (open && initialText !== undefined) setText(initialText);
  }, [open, initialText]);
  const [overrides, setOverrides] = useState<Record<string, ImportChoice>>({});
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const parsed = useMemo(() => parseRoutineText(text), [text]);
  const byId = useMemo(() => new Map((exercises ?? []).map((e) => [e.id, e] as const)), [exercises]);

  // Their exercises and every library entry they have not added, as one pool. A name is looked up
  // once per pool, not once per keystroke: the library is some eight hundred names.
  const matcher = useMemo(() => {
    const candidates = candidatesFromRows(listRows);
    const byKey = new Map(listRows.map((r) => [r.key, r] as const));
    const cache = new Map<string, ExerciseMatch | null>();
    return (name: string): ImportChoice | undefined => {
      if (!cache.has(name)) cache.set(name, matchExercise(name, candidates));
      const hit = cache.get(name);
      const row = hit ? byKey.get(hit.id) : undefined;
      return row ? choiceFor(row) : undefined;
    };
  }, [listRows]);

  // A built row's exercise, from its list key. A library row the owner has since made theirs (a
  // saved copy of it, or one of the same name) is no longer on the list, and the exercise they have is the row.
  const known = useMemo(() => {
    const byKey = new Map(listRows.map((r) => [r.key, r] as const));
    return (key: string, name: string): ImportChoice | undefined => {
      const row = byKey.get(key);
      if (row) return choiceFor(row);
      const have = findExistingExercise(exercises ?? [], key, name);
      return have ? { kind: 'existing', exerciseId: have.id } : undefined;
    };
  }, [listRows, exercises]);

  const rows = useMemo(() => {
    const written = new Map<string, number>();
    return parsed.routines.map((routine, ri) =>
      routine.exercises.map((line, ei) => {
        const key = rowKey(ri, ei, line);
        const name = normaliseName(line.name);
        const nth = written.get(name) ?? 0;
        written.set(name, nth + 1);
        const builtKey = preMatched?.get(name)?.[nth];
        const fromBuild = builtKey !== undefined ? known(builtKey, line.name) : undefined;
        // A built row that cannot be found yet (the catalogue is still on its way) waits; it is never matched from its name.
        const choice: ImportChoice | undefined = overrides[key] ?? (builtKey !== undefined ? fromBuild : matcher(line.name));
        return { key, line, choice };
      }),
    );
  }, [parsed, matcher, overrides, preMatched, known]);
  const total = rows.reduce((n, r) => n + r.length, 0);
  const pending = rows.reduce((n, r) => n + r.filter((row) => !row.choice).length, 0);

  const reset = () => {
    setText('');
    setOverrides({});
    setPickerFor(null);
  };
  const close = () => {
    if (saving) return;
    reset();
    onClose();
  };

  const choose = (key: string, choice: ImportChoice) => setOverrides((prev) => ({ ...prev, [key]: choice }));

  const save = async () => {
    if (saving || pending > 0 || total === 0) return;
    setSaving(true);
    try {
      // All routines of the paste in one transaction: all saved, or none (and Save can be retried).
      const saved = await saveParsedRoutines(
        parsed.routines.map((routine, ri) => ({
          name: routine.name,
          rows: rows[ri]!.map((r): ImportRow => ({ line: r.line, choice: r.choice! })),
        })),
      );
      toast(saved.length === 1 ? 'Routine saved' : `${saved.length} routines saved`);
      reset();
      setSaving(false);
      onClose();
      if (saved.length === 1) nav(`/routines/${saved[0]!.id}`);
    } catch {
      setSaving(false);
      toast('Could not save the routine', 'danger');
    }
  };

  const nameFor = (choice: ImportChoice | undefined, line: ParsedRoutineLine): string => {
    switch (choice?.kind) {
      case 'existing':
        return byId.get(choice.exerciseId)?.name ?? line.name;
      case 'catalogue':
        return choice.entry.name;
      case 'demo':
        return choice.demo.name;
      default:
        return line.name;
    }
  };

  return (
    <>
      <Sheet
        open={open}
        onClose={close}
        title={title}
        footer={
          <div className="grid grid-cols-2 gap-3">
            <Button size="lg" variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button size="lg" variant="primary" disabled={saving || pending > 0 || total === 0} onClick={() => void save()} data-testid="paste-save">
              {parsed.routines.length > 1 ? `Save ${parsed.routines.length} routines` : 'Save routine'}
            </Button>
          </div>
        }
      >
        <TextInput multiline value={text} onChange={setText} placeholder={'Upper A\nBench press 4x6-8 @ 80kg\nLat pulldown 3x10-12'} testId="paste-text" />

        {(pending > 0 || parsed.ignored.length > 0) && (
          <div className="mt-2 px-1 text-sm text-muted" data-testid="paste-facts">
            {[pending > 0 ? `${fmtNum(pending)} to choose` : '', parsed.ignored.length > 0 ? `${fmtNum(parsed.ignored.length)} ${parsed.ignored.length === 1 ? 'line' : 'lines'} not used` : '']
              .filter(Boolean)
              .join(' · ')}
          </div>
        )}

        {parsed.routines.map((routine, ri) => (
          <div key={`${ri}-${routine.name}`} data-testid={`paste-routine-${ri}`}>
            <div className="flex items-end justify-between px-1 pb-2 pt-5">
              <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-muted">
                {routine.name} · {fmtNum(routine.exercises.length)} {routine.exercises.length === 1 ? 'exercise' : 'exercises'}
              </h2>
            </div>
            <Card>
              {rows[ri]!.map((row, ei) => {
                const name = nameFor(row.choice, row.line);
                const matched = row.choice !== undefined && row.choice.kind !== 'new';
                const renamed = matched && name.toLowerCase() !== row.line.name.toLowerCase();
                const fromLibrary = row.choice?.kind === 'catalogue' || row.choice?.kind === 'demo';
                // Seconds are only kept by a timed exercise: say so when the line's numbers will not be written.
                const kind = row.choice ? kindOfChoice(row.choice, row.line, byId) : undefined;
                const notUsed = kind !== undefined && row.line.repMin !== undefined && !keepsNumbers(row.line, kind);
                return (
                  <div key={row.key}>
                    {ei > 0 && <Divider />}
                    <div className="flex min-h-14 items-center gap-3 py-3 pl-4 pr-3" data-testid="paste-row">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <div className="min-w-0 truncate font-semibold leading-tight" data-testid="paste-row-name">
                            {name}
                          </div>
                          {fromLibrary && <LibraryLabel />}
                        </div>
                        <div className="mt-0.5 truncate text-sm text-muted">
                          {prescription(row.line)}
                          {notUsed ? ` · ${fmtRange(row.line.repMin!, row.line.repMax ?? row.line.repMin!, 's')} not used` : ''}
                          {renamed ? ` · from “${row.line.name}”` : ''}
                          {row.choice?.kind === 'new' ? ' · new exercise' : ''}
                        </div>
                      </div>
                      {row.choice ? (
                        <Button size="sm" variant="ghost" onClick={() => setPickerFor(row.key)} data-testid="paste-change">
                          Change
                        </Button>
                      ) : (
                        <div className="flex shrink-0 gap-1">
                          <Button size="sm" variant="secondary" onClick={() => setPickerFor(row.key)} data-testid="paste-choose">
                            Choose
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => choose(row.key, { kind: 'new' })} data-testid="paste-add-new">
                            Add new
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </Card>
          </div>
        ))}
        <div className="h-2" />
      </Sheet>

      <ExercisePicker
        open={pickerFor !== null}
        onClose={() => setPickerFor(null)}
        title="Choose exercise"
        onPick={(exercise) => {
          if (pickerFor) choose(pickerFor, { kind: 'existing', exerciseId: exercise.id });
          setPickerFor(null);
        }}
        onPickLibrary={(row) => {
          if (pickerFor) choose(pickerFor, choiceFor(row));
          setPickerFor(null);
        }}
      />
    </>
  );
}
