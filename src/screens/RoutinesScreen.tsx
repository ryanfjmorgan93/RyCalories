import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { db } from '@/db/db';
import { createRoutine, deleteRoutine, duplicateRoutine, reorderRoutines } from '@/db/repo';
import type { Routine } from '@/domain/types';
import { Button, IconButton } from '@/ui/components/Button';
import { Card, Divider, EmptyState, Row } from '@/ui/components/Card';
import { Toggle } from '@/ui/components/Chip';
import { NumberInput, TextInput } from '@/ui/components/NumberField';
import { Confirm, Sheet } from '@/ui/components/Sheet';
import { toast } from '@/ui/components/Toast';
import { MoreIcon, PlusIcon, TopBar } from '@/ui/components/TopBar';
import { useRoutines } from '@/ui/hooks';

export function RoutinesScreen() {
  const nav = useNavigate();
  const routines = useRoutines();
  const [newOpen, setNewOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<Routine | null>(null);
  const [deleteFor, setDeleteFor] = useState<Routine | null>(null);

  const exerciseCount = useLiveQuery(() => db.exercises.count(), []);

  const rxCounts = useLiveQuery(async () => {
    const all = await db.routineExercises.toArray();
    const m = new Map<string, number>();
    for (const rx of all) m.set(rx.routineId, (m.get(rx.routineId) ?? 0) + 1);
    return m;
  }, []);

  const move = async (index: number, dir: -1 | 1) => {
    if (!routines) return;
    const to = index + dir;
    if (to < 0 || to >= routines.length) return;
    const ids = routines.map((r) => r.id);
    [ids[index], ids[to]] = [ids[to], ids[index]];
    await reorderRoutines(ids);
  };

  const subtitleFor = (r: Routine) => {
    const n = rxCounts?.get(r.id) ?? 0;
    return `${n} ${n === 1 ? 'exercise' : 'exercises'}${r.targetMinutes ? ` · target ${r.targetMinutes} min` : ''}${r.isLowerBody ? ' · lower' : ''}`;
  };

  return (
    <div>
      <TopBar
        title="Routines"
        right={
          <IconButton label="New routine" onClick={() => setNewOpen(true)} data-testid="new-routine">
            <PlusIcon />
          </IconButton>
        }
      />
      <div className="px-4">
        <div className="h-2" />
        {routines === undefined && <div className="py-8 text-center text-sm text-muted">Loading…</div>}
        {routines && routines.length === 0 && <EmptyState>No routines yet. Tap + to add one.</EmptyState>}
        {routines && routines.length > 0 && (
          <Card>
            {routines.map((r, i) => (
              <div key={r.id}>
                {i > 0 && <Divider />}
                <Row
                  onClick={() => nav(`/routines/${r.id}`)}
                  title={r.name}
                  subtitle={subtitleFor(r)}
                  right={
                    <div className="flex items-center">
                      <IconButton label="Move up" disabled={i === 0} onClick={() => void move(i, -1)}>
                        <UpIcon />
                      </IconButton>
                      <IconButton label="Move down" disabled={i === routines.length - 1} onClick={() => void move(i, 1)}>
                        <DownIcon />
                      </IconButton>
                      <IconButton label="More" onClick={() => setMenuFor(r)} data-testid={`routine-more-${r.name}`}>
                        <MoreIcon />
                      </IconButton>
                    </div>
                  }
                />
              </div>
            ))}
          </Card>
        )}
        <div className="h-4" />
        <Card>
          <Row
            onClick={() => nav('/exercises')}
            left={<DumbbellIcon />}
            title="Exercise library"
            subtitle={exerciseCount === undefined ? undefined : `${exerciseCount} exercises`}
          />
        </Card>
        <div className="h-6" />
      </div>

      <NewRoutineSheet open={newOpen} onClose={() => setNewOpen(false)} />

      <Sheet open={menuFor !== null} onClose={() => setMenuFor(null)} title={menuFor?.name}>
        <div className="grid gap-3">
          <Button
            size="lg"
            full
            onClick={async () => {
              if (!menuFor) return;
              const copy = await duplicateRoutine(menuFor.id);
              setMenuFor(null);
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
              setDeleteFor(menuFor);
              setMenuFor(null);
            }}
          >
            Delete
          </Button>
        </div>
      </Sheet>

      <Confirm
        open={deleteFor !== null}
        title={`Delete ${deleteFor?.name ?? 'routine'}?`}
        body="Past sessions are kept. A routine with sessions is archived rather than deleted."
        confirmLabel="Delete"
        danger
        onCancel={() => setDeleteFor(null)}
        onConfirm={async () => {
          if (!deleteFor) return;
          const result = await deleteRoutine(deleteFor.id);
          setDeleteFor(null);
          toast(result === 'deleted' ? 'Routine deleted' : 'Routine archived (it has sessions)');
        }}
      />
    </div>
  );
}

function NewRoutineSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [lower, setLower] = useState(false);
  const [target, setTarget] = useState<number | null>(null);

  const reset = () => {
    setName('');
    setLower(false);
    setTarget(null);
  };

  const create = async () => {
    const r = await createRoutine({ name, isLowerBody: lower, targetMinutes: target ?? undefined });
    reset();
    onClose();
    nav(`/routines/${r.id}`);
  };

  return (
    <Sheet
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="New routine"
      footer={
        <Button size="lg" variant="primary" full disabled={!name.trim()} onClick={() => void create()} data-testid="create-routine">
          Create
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

/** Moved here from the bottom navigation when the Food tab took its place. */
function DumbbellIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-muted">
      <path d="M6 7v10M18 7v10M3 9v6M21 9v6M6 12h12" />
    </svg>
  );
}
