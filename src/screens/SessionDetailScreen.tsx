import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams } from 'react-router-dom';
import { recordsForNewSets } from '@/db/recordsQueries';
import { createRoutineFromSession, deleteSession, sessionDetail, type SessionGroup } from '@/db/repo';
import { sessionSeconds } from '@/db/historyQueries';
import { fmtDateLong, fmtDuration, fmtKg, fmtNum, fmtWeight, targetLine } from '@/domain/format';
import { countsForVolume, feelLabel, setBadges } from '@/domain/sets';
import type { ExerciseKind, ProgressionDecision, Session, SetLog } from '@/domain/types';
import { Button, IconButton } from '@/ui/components/Button';
import { Card, Divider, Stat } from '@/ui/components/Card';
import { Chip } from '@/ui/components/Chip';
import { Confirm, Sheet } from '@/ui/components/Sheet';
import { toast } from '@/ui/components/Toast';
import { MoreIcon, TopBar } from '@/ui/components/TopBar';
import { useRoutineItems } from '@/ui/hooks';

const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : timeFmt.format(d);
}

export function SessionDetailScreen() {
  const { id } = useParams();
  const nav = useNavigate();
  const detail = useLiveQuery(() => (id ? sessionDetail(id) : null), [id]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    if (detail?.session && !detail.session.endedAt) nav(`/session/${detail.session.id}`, { replace: true });
  }, [detail, nav]);

  if (detail === undefined) {
    return (
      <div>
        <TopBar title="Session" back />
        <div className="px-4 py-8 text-muted">Loading…</div>
      </div>
    );
  }

  if (detail === null) {
    return (
      <div>
        <TopBar title="Session" back />
        <div className="px-4 py-8 text-center text-muted">Session not found</div>
      </div>
    );
  }

  const { session, groups } = detail;
  if (!session.endedAt) return null;

  const allSets = groups.flatMap((g) => g.sets);
  const working = allSets.filter((s) => countsForVolume(s.type)).length;
  const warmups = allSets.length - working;

  return (
    <div>
      <TopBar
        title={session.title}
        subtitle={`${fmtDateLong(session.startedAt)}, ${fmtTime(session.startedAt)}${session.deload ? ' · Deload' : ''}`}
        back
        right={
          <IconButton label="More" onClick={() => setMenuOpen(true)}>
            <MoreIcon />
          </IconButton>
        }
      />
      <div className="px-4">
        <Card className="mt-2 flex items-center gap-6 px-4 py-3">
          <Stat label="Time" value={fmtDuration(sessionSeconds(session))} />
          <Stat label="Sets" value={working} sub={warmups > 0 ? `+${warmups} warm-up` : undefined} />
          <Stat label="Exercises" value={groups.length} />
        </Card>

        {session.source === 'hevy' && (
          <div className="mt-3">
            <Chip size="sm">Imported from Hevy</Chip>
          </div>
        )}

        <SwappedSkippedList session={session} groups={groups} />

        {groups.length === 0 && <div className="py-8 text-center text-sm text-muted">No sets logged</div>}

        {groups.map((g) => (
          <GroupCard key={g.sets[0]?.routineExerciseId ?? `x:${g.exercise.id}`} group={g} session={session} />
        ))}

        <SessionExtras session={session} />

        {/* A session with no sets builds a routine with no exercises — a button that leads nowhere. */}
        <Button
          className="mt-4"
          full
          size="lg"
          disabled={groups.length === 0}
          data-testid="save-as-routine"
          onClick={async () => {
            const routine = await createRoutineFromSession(session.id);
            toast('Routine saved', 'ok');
            nav(`/routines/${routine.id}`);
          }}
        >
          Save as routine
        </Button>
        <div className="h-6" />
      </div>

      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title={session.title}>
        <Button
          size="lg"
          variant="danger"
          full
          onClick={() => {
            setMenuOpen(false);
            setDeleteOpen(true);
          }}
        >
          Delete session
        </Button>
      </Sheet>

      <Confirm
        open={deleteOpen}
        title="Delete this session?"
        body="Its sets and decisions are deleted. Weights stay as they are."
        confirmLabel="Delete"
        danger
        onCancel={() => setDeleteOpen(false)}
        onConfirm={async () => {
          await deleteSession(session.id);
          setDeleteOpen(false);
          nav('/history', { replace: true });
          toast('Session deleted');
        }}
      />
    </div>
  );
}

/** Routine-exercises skipped in favour of a session-only swap: they never get a `GroupCard` of
 * their own (no sets were logged against them), so this lists what stood in for what. */
function SwappedSkippedList({ session, groups }: { session: Session; groups: SessionGroup[] }) {
  const items = useRoutineItems(session.routineId || undefined);
  const rows = useMemo(() => {
    if (!items) return [];
    const swaps = session.swaps ?? {};
    const skippedIds = new Set(session.skippedRoutineExerciseIds ?? []);
    return items
      .filter((it) => skippedIds.has(it.rx.id) && swaps[it.rx.id])
      .map((it) => {
        const subId = swaps[it.rx.id];
        const subName = groups.find((g) => g.exercise.id === subId)?.exercise.name ?? '';
        return { rxId: it.rx.id, originalName: it.exercise.name, subName };
      });
  }, [items, session.swaps, session.skippedRoutineExerciseIds, groups]);

  if (rows.length === 0) return null;
  return (
    <div className="mt-3 grid gap-2">
      {rows.map((r) => (
        <div key={r.rxId} className="rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-sm">
          <span className="font-semibold">{r.originalName}</span>
          <span className="text-muted"> · Swapped for {r.subName}</span>
        </div>
      ))}
    </div>
  );
}

function GroupCard({ group, session }: { group: SessionGroup; session: Session }) {
  const nav = useNavigate();
  const { rx, exercise, sets, decision } = group;
  const kind = exercise.kind;
  const badges = setBadges(sets);
  // "Extra" means logged outside the routine; a routine-exercise deleted since is not extra.
  const isExtra = sets[0]?.routineExerciseId === null;

  // A finished session's PR chips reflect what stood *at the time*: records already set later
  // (by a subsequent session) don't retroactively un-PR a set logged here.
  const prRecords = useLiveQuery(
    () =>
      sets.length > 0
        ? recordsForNewSets(exercise.id, sets[0].sessionId, sets, {
            before: session.startedAt,
            // The same rule the live session and Summary applied at the time: no record while calibrating.
            calibrating: decision?.rule === 'calibrating',
          })
        : [],
    [exercise.id, sets, session.startedAt, decision?.rule],
  );
  const prIndices = useMemo(() => new Set((prRecords ?? []).map((r) => r.setIndex)), [prRecords]);

  return (
    <Card className="mt-3 overflow-hidden">
      <button type="button" className="block w-full min-h-14 px-4 py-3 text-left active:bg-surface-2" onClick={() => nav(`/exercises/${exercise.id}`)}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-lg font-extrabold leading-tight">{exercise.name}</span>
          {isExtra && <Chip size="sm">extra</Chip>}
        </div>
        {rx && (
          <div className="mt-0.5 text-sm text-muted">
            {targetLine(rx, kind)}
            {exercise.unilateral ? ' · per side' : ''}
          </div>
        )}
      </button>

      <div className="border-t border-line">
        {sets.map((s, i) => (
          <div key={s.id} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0">
            <span className={`num w-7 text-center text-sm font-bold ${badges[i] === 'W' ? 'text-warn' : badges[i] === 'D' ? 'text-info' : 'text-muted'}`}>{badges[i]}</span>
            <span className="num flex-1 text-lg font-bold">{setLabel(s, kind)}</span>
            {prIndices.has(i) && (
              <span data-testid="pr-chip">
                <Chip size="sm" tone="ok">PR</Chip>
              </span>
            )}
            {s.rir !== undefined && <Chip size="sm">{feelLabel(s.rir)}</Chip>}
          </div>
        ))}
      </div>

      {decision && <DecisionLine decision={decision} kind={kind} />}
    </Card>
  );
}

function DecisionLine({ decision, kind }: { decision: ProgressionDecision; kind: ExerciseKind }) {
  const w = (n: number) => fmtWeight(kind, n);
  let text: string | null = null;
  let tone = 'text-muted';
  switch (decision.rule) {
    case 'increase':
      text = `→ ${w(decision.toWeight)} next time`;
      tone = 'text-ok';
      break;
    case 'hold':
    case 'hold_missing_sets':
      text = `hold ${w(decision.toWeight)}`;
      break;
    case 'calibrating':
      text = 'calibrating';
      tone = 'text-info';
      break;
    case 'lock_in':
      text = `locked in at ${w(decision.toWeight)}`;
      break;
    case 'not_applicable':
      text = null;
  }
  if (text === null && decision.overrideTo === undefined) return null;
  return (
    <div className={`border-t border-line px-4 py-2.5 text-sm font-semibold ${tone}`}>
      {text ?? 'no weight decision'}
      {decision.overrideTo !== undefined && <span className="text-accent"> · override to {w(decision.overrideTo)}</span>}
    </div>
  );
}

function SessionExtras({ session }: { session: Session }) {
  const niggles = session.niggles ?? [];
  const notes = session.notes?.trim() ?? '';
  const checklist = session.checklist;
  if (niggles.length === 0 && !notes && !checklist) return null;

  return (
    <>
      {niggles.length > 0 && (
        <Card className="mt-3 p-4">
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Niggles</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {niggles.map((n, i) => (
              <Chip key={`${n.tag}-${i}`} size="sm" tone="danger">
                {n.tag} · {n.severity}
              </Chip>
            ))}
          </div>
          {niggles.some((n) => n.note) && (
            <div className="mt-2 space-y-1 text-sm text-muted">
              {niggles.filter((n) => n.note).map((n, i) => (
                <div key={`${n.tag}-note-${i}`}>
                  <span className="text-fg">{n.tag}:</span> {n.note}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {notes && (
        <Card className="mt-3 p-4">
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Notes</div>
          <div className="mt-1 whitespace-pre-wrap text-sm">{notes}</div>
        </Card>
      )}

      {checklist && (
        <Card className="mt-3">
          <div className="px-4 pt-3 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Leg-day checklist</div>
          <ChecklistRow label="Electrolytes" done={!!checklist.electrolytes} />
          <Divider />
          <ChecklistRow label="Protein 200 g" done={!!checklist.protein} />
        </Card>
      )}
    </>
  );
}

function ChecklistRow({ label, done }: { label: string; done: boolean }) {
  return (
    <div className="flex min-h-12 items-center justify-between px-4 py-2 text-sm">
      <span>{label}</span>
      <span className={`num font-bold ${done ? 'text-ok' : 'text-dim'}`}>{done ? '✓' : '–'}</span>
    </div>
  );
}

function setLabel(s: SetLog, kind: ExerciseKind): string {
  if (kind === 'carry') {
    const parts = [fmtKg(s.weight)];
    if (s.distanceM !== undefined) parts.push(`${fmtNum(s.distanceM)} m`);
    if (s.seconds !== undefined) parts.push(`${fmtNum(s.seconds)} s`);
    return parts.join(' · ');
  }
  if (kind === 'timed') return `${fmtNum(s.seconds ?? 0)} s`;
  const w = kind === 'bodyweight_plus' ? (s.weight === 0 ? 'BW' : `+${fmtNum(s.weight)}`) : fmtNum(s.weight);
  return `${w} × ${s.reps ?? 0}`;
}
