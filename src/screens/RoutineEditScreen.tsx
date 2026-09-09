import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams } from 'react-router-dom';
import { db } from '@/db/db';
import { addRoutineExercise, deleteRoutine, duplicateRoutine, reorderRoutineExercises, startSession, updateRoutine, type RoutineItem } from '@/db/repo';
import { targetLine } from '@/domain/format';
import type { Routine } from '@/domain/types';
import { Button, IconButton } from '@/ui/components/Button';
import { Card, EmptyState, SectionTitle } from '@/ui/components/Card';
import { Chip, Toggle } from '@/ui/components/Chip';
import { NumberInput, TextInput } from '@/ui/components/NumberField';
import { Confirm, Sheet } from '@/ui/components/Sheet';
import { toast } from '@/ui/components/Toast';
import { MoreIcon, TopBar } from '@/ui/components/TopBar';
import { ExercisePicker } from '@/ui/ExercisePicker';
import { defaultRestSec, RoutineExerciseEditor } from '@/ui/RoutineExerciseEditor';
import { useActiveSession, useRoutineItems, useSettings } from '@/ui/hooks';

export function RoutineEditScreen() {
  const { id } = useParams();
  const nav = useNavigate();
  // null = not found, undefined = loading.
  const routine = useLiveQuery(async () => (id ? ((await db.routines.get(id)) ?? null) : null), [id]);
  const items = useRoutineItems(id);
  const active = useActiveSession();
  const settings = useSettings();

  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const editing = editingId ? (items ?? []).find((it) => it.rx.id === editingId) ?? null : null;

  if (routine === undefined) return <Loading />;
  if (routine === null || routine.archived) {
    return (
      <div>
        <TopBar title="Routine" back="/routines" />
        <div className="px-4 pt-8 text-center">
          <div className="text-lg font-bold">Routine not found</div>
          <Button className="mt-4" variant="outline" onClick={() => nav('/routines')}>
            Back to routines
          </Button>
        </div>
      </div>
    );
  }

  const move = async (index: number, dir: -1 | 1) => {
    if (!items) return;
    const to = index + dir;
    if (to < 0 || to >= items.length) return;
    const ids = items.map((it) => it.rx.id);
    [ids[index], ids[to]] = [ids[to], ids[index]];
    await reorderRoutineExercises(ids);
  };

  const start = async () => {
    if (active) {
      nav(`/session/${active.id}`);
      return;
    }
    const s = await startSession(routine.id);
    nav(`/session/${s.id}`);
  };

  return (
    <div>
      <TopBar
        title={routine.name}
        subtitle={[routine.isLowerBody ? 'Lower body' : null, routine.targetMinutes ? `target ${routine.targetMinutes} min` : null].filter(Boolean).join(' · ') || undefined}
        back="/routines"
        right={
          <IconButton label="More" onClick={() => setMenuOpen(true)} data-testid="routine-menu">
            <MoreIcon />
          </IconButton>
        }
      />
      <div className="px-4">
        <SectionTitle>Exercises</SectionTitle>
        {items === undefined && <Loading />}
        {items && items.length === 0 && <EmptyState>No exercises yet.</EmptyState>}
        <div className="grid gap-2">
          {(items ?? []).map((it, i) => (
            <ExerciseItemCard
              key={it.rx.id}
              item={it}
              restSec={it.rx.restSecOverride ?? defaultRestSec(it.exercise, settings)}
              canUp={i > 0}
              canDown={i < (items?.length ?? 0) - 1}
              onUp={() => void move(i, -1)}
              onDown={() => void move(i, 1)}
              onOpen={() => setEditingId(it.rx.id)}
            />
          ))}
        </div>
        <Button className="mt-3" variant="outline" size="lg" full onClick={() => setPickerOpen(true)} data-testid="add-exercise">
          Add exercise
        </Button>

        <div className="mt-6">
          <Button size="xl" variant="primary" full onClick={() => void start()} data-testid="start-routine">
            {active ? `Resume ${active.title}` : 'Start this routine'}
          </Button>
        </div>
        <div className="h-6" />
      </div>

      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title={routine.name}>
        <div className="grid gap-3">
          <Button
            size="lg"
            full
            onClick={() => {
              setMenuOpen(false);
              setSettingsOpen(true);
            }}
          >
            Rename and settings
          </Button>
          <Button
            size="lg"
            full
            onClick={async () => {
              const copy = await duplicateRoutine(routine.id);
              setMenuOpen(false);
              toast('Routine duplicated');
              nav(`/routines/${copy.id}`);
            }}
          >
            Duplicate
          </Button>
          <Button
            size="lg"
            full
            variant="danger"
            onClick={() => {
              setMenuOpen(false);
              setDeleteOpen(true);
            }}
          >
            Delete
          </Button>
        </div>
      </Sheet>

      {/* Keyed on open so the form re-seeds from the routine each time the sheet opens. */}
      <RoutineSettingsSheet key={`${routine.id}:${settingsOpen}`} open={settingsOpen} routine={routine} onClose={() => setSettingsOpen(false)} />

      <Confirm
        open={deleteOpen}
        title={`Delete ${routine.name}?`}
        body="Past sessions are kept. A routine with sessions is archived rather than deleted."
        confirmLabel="Delete"
        danger
        onCancel={() => setDeleteOpen(false)}
        onConfirm={async () => {
          const result = await deleteRoutine(routine.id);
          setDeleteOpen(false);
          toast(result === 'deleted' ? 'Routine deleted' : 'Routine archived (it has sessions)');
          nav('/routines');
        }}
      />

      <ExercisePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        exclude={(items ?? []).map((it) => it.exercise.id)}
        onCreate={() => nav('/exercises/new')}
        onPick={async (exercise) => {
          const rx = await addRoutineExercise(routine.id, exercise.id);
          setPickerOpen(false);
          setEditingId(rx.id);
        }}
      />

      {/* Keyed on the loaded item so the form state initialises from the real record. */}
      <RoutineExerciseEditor key={editing?.rx.id ?? 'none'} open={editing !== null} item={editing} onClose={() => setEditingId(null)} />
    </div>
  );
}

function Loading() {
  return <div className="px-4 py-8 text-center text-sm text-muted">Loading…</div>;
}

function ExerciseItemCard({
  item,
  restSec,
  canUp,
  canDown,
  onUp,
  onDown,
  onOpen,
}: {
  item: RoutineItem;
  restSec: number;
  canUp: boolean;
  canDown: boolean;
  onUp: () => void;
  onDown: () => void;
  onOpen: () => void;
}) {
  const { rx, exercise } = item;
  const chips = [
    rx.mode === 'calibrating' ? { key: 'cal', tone: 'info' as const, label: 'calibrating' } : null,
    rx.optional ? { key: 'opt', tone: 'neutral' as const, label: 'optional' } : null,
    exercise.unilateral ? { key: 'side', tone: 'neutral' as const, label: 'per side' } : null,
  ].filter((c): c is { key: string; tone: 'info' | 'neutral'; label: string } => c !== null);

  return (
    <Card className={`flex items-stretch ${rx.optional ? 'opacity-70' : ''}`} data-testid={`rx-card-${exercise.name}`}>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 px-4 py-3 text-left active:bg-surface-2 rounded-l-2xl">
        <div className="truncate text-lg font-bold leading-tight">{exercise.name}</div>
        <div className="mt-1 text-sm text-muted">
          {targetLine(rx, exercise.kind)} · rest {Math.round(restSec)} s
        </div>
        {chips.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <Chip key={c.key} size="sm" tone={c.tone}>
                {c.label}
              </Chip>
            ))}
          </div>
        )}
        {rx.cue && <div className="mt-2 text-[15px] font-semibold leading-snug text-accent">{rx.cue}</div>}
      </button>
      <div className="flex flex-col items-center justify-center border-l border-line px-1">
        <IconButton label="Move up" disabled={!canUp} onClick={onUp}>
          <UpIcon />
        </IconButton>
        <IconButton label="Move down" disabled={!canDown} onClick={onDown}>
          <DownIcon />
        </IconButton>
      </div>
    </Card>
  );
}

function RoutineSettingsSheet({ open, routine, onClose }: { open: boolean; routine: Routine; onClose: () => void }) {
  const [name, setName] = useState(routine.name);
  const [lower, setLower] = useState(routine.isLowerBody);
  const [target, setTarget] = useState<number | null>(routine.targetMinutes ?? null);

  const save = async () => {
    await updateRoutine(routine.id, { name: name.trim() || routine.name, isLowerBody: lower, targetMinutes: target ?? undefined });
    toast('Saved', 'ok');
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Rename and settings"
      footer={
        <Button size="lg" variant="primary" full onClick={() => void save()} data-testid="routine-save">
          Save
        </Button>
      }
    >
      <FieldLabel>Name</FieldLabel>
      <TextInput value={name} onChange={setName} placeholder="Routine name" autoFocus testId="routine-name" />
      <Toggle checked={lower} onChange={setLower} label="Lower-body day" />
      <FieldLabel>Target minutes</FieldLabel>
      <NumberInput value={target} onChange={setTarget} mode="numeric" min={1} placeholder="Optional" />
      <div className="h-2" />
    </Sheet>
  );
}

function FieldLabel({ children }: { children: string }) {
  return <div className="mb-1 mt-3 px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">{children}</div>;
}

function UpIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 15l6-6 6 6" />
    </svg>
  );
}

function DownIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
