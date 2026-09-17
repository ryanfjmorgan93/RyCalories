import { useEffect, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { useNavigate, useParams } from 'react-router-dom';
import { createExercise, deleteExercise, exerciseUsage, updateExercise, type ExerciseInput } from '@/db/repo';
import { demoFrameUrl, searchDemos } from '@/data/exerciseDemos';
import { EQUIPMENT_KINDS, MUSCLE_GROUPS, type Equipment, type Exercise, type ExerciseKind, type MuscleGroup } from '@/domain/types';
import { STRENGTH_STANDARDS, type StrengthStandard } from '@/domain/standards';
import { Button } from '@/ui/components/Button';
import { Card, Divider, EmptyState } from '@/ui/components/Card';
import { Chip, Segmented, Toggle } from '@/ui/components/Chip';
import { NumberInput, TextInput } from '@/ui/components/NumberField';
import { Confirm, Sheet } from '@/ui/components/Sheet';
import { toast } from '@/ui/components/Toast';
import { TopBar } from '@/ui/components/TopBar';


const KIND_OPTIONS: { value: ExerciseKind; label: ReactNode }[] = [
  { value: 'reps', label: 'Reps' },
  { value: 'bodyweight_plus', label: 'Bodyweight +' },
  { value: 'carry', label: 'Carry' },
  { value: 'timed', label: 'Timed' },
];

const STANDARD_OPTIONS: { value: StrengthStandard | 'none'; label: string }[] = [
  { value: 'none', label: 'None' },
  ...STRENGTH_STANDARDS.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) })),
];

interface Form {
  name: string;
  kind: ExerciseKind;
  muscleGroup: MuscleGroup;
  isCompound: boolean;
  isLowerBody: boolean;
  unilateral: boolean;
  defaultRestSec: number | null;
  defaultIncrement: number | null;
  notes: string;
  aliases: string[];
  equipment: Equipment | undefined;
  demo: string | undefined;
  videoUrl: string;
  standard: StrengthStandard | 'none';
}

const NEW_FORM: Form = {
  name: '',
  kind: 'reps',
  muscleGroup: 'other',
  isCompound: false,
  isLowerBody: false,
  unilateral: false,
  defaultRestSec: 75,
  defaultIncrement: 2.5,
  notes: '',
  aliases: [],
  equipment: undefined,
  demo: undefined,
  videoUrl: '',
  standard: 'none',
};

function fromExercise(e: Exercise): Form {
  return {
    name: e.name,
    kind: e.kind,
    muscleGroup: e.muscleGroup,
    isCompound: e.isCompound,
    isLowerBody: e.isLowerBody,
    unilateral: e.unilateral,
    defaultRestSec: e.defaultRestSec,
    defaultIncrement: e.defaultIncrement,
    notes: e.notes ?? '',
    aliases: e.aliases ?? [],
    equipment: e.equipment,
    demo: e.demo,
    videoUrl: e.videoUrl ?? '',
    standard: e.standard ?? 'none',
  };
}

function defaultRest(compound: boolean, kind: ExerciseKind): number {
  if (compound) return 150;
  if (kind === 'carry') return 90;
  return 75;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="py-3">
      <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">{label}</div>
      {children}
    </div>
  );
}

export function ExerciseEditScreen() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const isNew = id === undefined;
  // null = not found (deleted or stale link); undefined = still loading.
  const existing = useLiveQuery(async () => (id ? ((await db.exercises.get(id)) ?? null) : null), [id]);
  const usage = useLiveQuery(() => (id ? exerciseUsage(id) : undefined), [id]);

  const [form, setForm] = useState<Form>(NEW_FORM);
  const [loaded, setLoaded] = useState(isNew);
  const [restTouched, setRestTouched] = useState(!isNew);
  const [aliasDraft, setAliasDraft] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [diagramOpen, setDiagramOpen] = useState(false);
  const [diagramQuery, setDiagramQuery] = useState('');

  useEffect(() => {
    if (!isNew && existing && !loaded) {
      setForm(fromExercise(existing));
      setLoaded(true);
    }
  }, [isNew, existing, loaded]);

  const patch = (p: Partial<Form>) => setForm((f) => ({ ...f, ...p }));

  const setCompound = (v: boolean) => {
    setForm((f) => ({ ...f, isCompound: v, defaultRestSec: restTouched ? f.defaultRestSec : defaultRest(v, f.kind) }));
  };
  const setKind = (v: ExerciseKind) => {
    setForm((f) => ({ ...f, kind: v, defaultRestSec: restTouched ? f.defaultRestSec : defaultRest(f.isCompound, v) }));
  };

  const addAlias = () => {
    const a = aliasDraft.trim();
    if (!a) return;
    const dup = form.aliases.some((x) => x.toLowerCase() === a.toLowerCase());
    if (!dup) patch({ aliases: [...form.aliases, a] });
    setAliasDraft('');
  };
  const removeAlias = (a: string) => patch({ aliases: form.aliases.filter((x) => x !== a) });

  const canSave = form.name.trim().length > 0 && !busy;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      const notes = form.notes.trim();
      const videoUrl = form.videoUrl.trim();
      const input: ExerciseInput = {
        name: form.name.trim(),
        kind: form.kind,
        muscleGroup: form.muscleGroup,
        isCompound: form.isCompound,
        isLowerBody: form.isLowerBody,
        unilateral: form.unilateral,
        defaultRestSec: form.defaultRestSec ?? defaultRest(form.isCompound, form.kind),
        defaultIncrement: form.defaultIncrement ?? 2.5,
        notes: notes ? notes : undefined,
        aliases: form.aliases.length ? form.aliases : undefined,
        equipment: form.equipment,
        demo: form.demo,
        videoUrl: videoUrl ? videoUrl : undefined,
        standard: form.standard === 'none' ? undefined : form.standard,
      };
      if (isNew) {
        const e = await createExercise(input);
        toast('Exercise added', 'ok');
        nav(`/exercises/${e.id}`, { replace: true });
      } else {
        await updateExercise(id, input);
        toast('Saved', 'ok');
        nav(-1);
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!id) return;
    const ok = await deleteExercise(id);
    setDeleteOpen(false);
    if (!ok) {
      toast('In use by a routine or history', 'danger');
      return;
    }
    toast('Exercise deleted');
    nav('/exercises', { replace: true });
  };

  return (
    <div>
      <TopBar title={isNew ? 'New exercise' : 'Edit exercise'} back />
      <div className="px-4">
        {!isNew && existing === null ? (
          <div className="pt-4">
            <EmptyState>Exercise not found</EmptyState>
          </div>
        ) : !loaded ? (
          <div className="py-4 text-sm text-muted">Loading…</div>
        ) : (
          <>
            <Card className="mt-2 px-4 py-1">
              <Field label="Name">
                <TextInput value={form.name} onChange={(v) => patch({ name: v })} placeholder="Exercise name" autoFocus={isNew} testId="exercise-name" />
              </Field>
              <Divider />
              <Field label="Kind">
                <Segmented value={form.kind} onChange={setKind} options={KIND_OPTIONS} />
              </Field>
              <Divider />
              <Field label="Muscle group">
                <div className="flex flex-wrap gap-2">
                  {MUSCLE_GROUPS.map((g) => (
                    <Chip key={g} className="min-h-11" active={form.muscleGroup === g} onClick={() => patch({ muscleGroup: g })}>
                      {g}
                    </Chip>
                  ))}
                </div>
              </Field>
              <Divider />
              <Field label="Equipment">
                <div className="flex flex-wrap gap-2">
                  {EQUIPMENT_KINDS.map((eq) => (
                    <Chip key={eq} className="min-h-11" active={form.equipment === eq} onClick={() => patch({ equipment: form.equipment === eq ? undefined : eq })}>
                      {eq}
                    </Chip>
                  ))}
                </div>
              </Field>
            </Card>

            <Card className="mt-3 px-4">
              <Toggle checked={form.isCompound} onChange={setCompound} label="Compound" sub="rest 150 s by default" />
              <Divider />
              <Toggle checked={form.isLowerBody} onChange={(v) => patch({ isLowerBody: v })} label="Lower body" />
              <Divider />
              <Toggle checked={form.unilateral} onChange={(v) => patch({ unilateral: v })} label="Unilateral" sub="log once per set, per side implied" />
            </Card>

            <Card className="mt-3 px-4 py-1">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Default rest (seconds)">
                  <NumberInput
                    value={form.defaultRestSec}
                    onChange={(v) => {
                      setRestTouched(true);
                      patch({ defaultRestSec: v });
                    }}
                    mode="numeric"
                    min={0}
                    placeholder="75"
                    testId="exercise-rest"
                  />
                </Field>
                <Field label="Default increment (kg)">
                  <NumberInput value={form.defaultIncrement} onChange={(v) => patch({ defaultIncrement: v })} min={0} placeholder="2.5" testId="exercise-increment" />
                </Field>
              </div>
              <Divider />
              <Field label="Notes">
                <TextInput value={form.notes} onChange={(v) => patch({ notes: v })} multiline placeholder="Optional" />
              </Field>
            </Card>

            <Card className="mt-3 px-4 py-1">
              <Field label="Diagram">
                <div className="flex items-center gap-3">
                  {form.demo && (
                    <img src={demoFrameUrl(form.demo, 1)} alt="" className="h-14 w-14 rounded-lg border border-line bg-surface-2 object-contain" />
                  )}
                  <Button variant="outline" onClick={() => setDiagramOpen(true)} data-testid="pick-diagram">
                    {form.demo ? 'Change diagram' : 'Pick a diagram'}
                  </Button>
                  {form.demo && (
                    <Button variant="ghost" onClick={() => patch({ demo: undefined })}>
                      Clear
                    </Button>
                  )}
                </div>
              </Field>
              <Divider />
              <Field label="Video link">
                <TextInput value={form.videoUrl} onChange={(v) => patch({ videoUrl: v })} placeholder="https://…" testId="exercise-video-url" />
              </Field>
              <Divider />
              <Field label="Strength standard">
                <div className="flex flex-wrap gap-2">
                  {STANDARD_OPTIONS.map((o) => (
                    <Chip key={o.value} className="min-h-11" active={form.standard === o.value} onClick={() => patch({ standard: o.value })}>
                      {o.label}
                    </Chip>
                  ))}
                </div>
              </Field>
            </Card>

            <Card className="mt-3 px-4 py-1">
              <Field label="Aliases">
                {form.aliases.length > 0 && (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {form.aliases.map((a) => (
                      <Chip key={a} className="min-h-11" onClick={() => removeAlias(a)}>
                        {a}
                        <span aria-label="Remove" className="ml-1 text-muted">
                          ×
                        </span>
                      </Chip>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <TextInput value={aliasDraft} onChange={setAliasDraft} placeholder="Alternative name" testId="alias-input" />
                  <Button variant="outline" disabled={!aliasDraft.trim()} onClick={addAlias}>
                    Add
                  </Button>
                </div>
                <div className="mt-2 text-xs text-muted">Matched on Hevy import.</div>
              </Field>
            </Card>

            <Button size="lg" variant="primary" full className="mt-5" disabled={!canSave} onClick={() => void save()} data-testid="save-exercise">
              Save
            </Button>

            {!isNew && (
              <div className="mt-6">
                {usage && (
                  <div className="mb-3 px-1 text-sm text-muted">
                    In {usage.routines} {usage.routines === 1 ? 'routine' : 'routines'} · {usage.sets} logged {usage.sets === 1 ? 'set' : 'sets'}
                  </div>
                )}
                <Button size="lg" variant="danger" full onClick={() => setDeleteOpen(true)} data-testid="delete-exercise">
                  Delete exercise
                </Button>
              </div>
            )}
            <div className="h-6" />
          </>
        )}
      </div>

      <Confirm
        open={deleteOpen}
        title="Delete this exercise?"
        body="Only unused exercises can be deleted."
        confirmLabel="Delete"
        danger
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => void remove()}
      />

      <Sheet
        open={diagramOpen}
        onClose={() => {
          setDiagramOpen(false);
          setDiagramQuery('');
        }}
        title="Pick a diagram"
      >
        <TextInput value={diagramQuery} onChange={setDiagramQuery} placeholder="Search" testId="diagram-search" />
        <div className="mt-3 grid max-h-[55dvh] gap-2 overflow-y-auto">
          {searchDemos(diagramQuery).map((d) => (
            <button
              key={d.slug}
              type="button"
              onClick={() => {
                patch({ demo: d.slug });
                setDiagramOpen(false);
                setDiagramQuery('');
              }}
              className="flex items-center gap-3 rounded-xl border border-line px-3 py-2 text-left active:bg-surface-2"
              data-testid={`diagram-${d.slug}`}
            >
              <img src={demoFrameUrl(d.slug, 1)} alt="" className="h-12 w-12 shrink-0 rounded-lg bg-surface-2 object-contain" />
              <div className="min-w-0">
                <div className="truncate font-semibold">{d.name}</div>
                <div className="text-xs text-muted">{d.equipment}</div>
              </div>
            </button>
          ))}
          {diagramQuery.trim() && searchDemos(diagramQuery).length === 0 && <div className="py-6 text-center text-sm text-muted">No matches</div>}
        </div>
      </Sheet>
    </div>
  );
}
