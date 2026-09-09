import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams } from 'react-router-dom';
import { deleteSession, sessionDetail, type SessionGroup } from '@/db/repo';
import { sessionSeconds } from '@/db/historyQueries';
import { fmtDateLong, fmtDuration, fmtKg, fmtNum, fmtWeight, targetLine } from '@/domain/format';
import type { ExerciseKind, ProgressionDecision, Session, SetLog } from '@/domain/types';
import { Button, IconButton } from '@/ui/components/Button';
import { Card, Divider, Stat } from '@/ui/components/Card';
import { Chip } from '@/ui/components/Chip';
import { Confirm, Sheet } from '@/ui/components/Sheet';
import { toast } from '@/ui/components/Toast';
import { MoreIcon, TopBar } from '@/ui/components/TopBar';

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
  const working = allSets.filter((s) => s.type === 'working').length;
  const warmups = allSets.length - working;

  return (
    <div>
      <TopBar
        title={session.title}
        subtitle={`${fmtDateLong(session.startedAt)}, ${fmtTime(session.startedAt)}`}
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

        {groups.length === 0 && <div className="py-8 text-center text-sm text-muted">No sets logged</div>}

        {groups.map((g) => (
          <GroupCard key={g.rx?.id ?? `x:${g.exercise.id}`} group={g} />
        ))}

        <SessionExtras session={session} />
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

function GroupCard({ group }: { group: SessionGroup }) {
  const nav = useNavigate();
  const { rx, exercise, sets, decision } = group;
  const kind = exercise.kind;
  const numbers = setNumbers(sets);

  return (
    <Card className="mt-3 overflow-hidden">
      <button type="button" className="block w-full min-h-14 px-4 py-3 text-left active:bg-surface-2" onClick={() => nav(`/exercises/${exercise.id}`)}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-lg font-extrabold leading-tight">{exercise.name}</span>
          {!rx && <Chip size="sm">extra</Chip>}
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
            <span className={`num w-7 text-center text-sm font-bold ${s.type === 'warmup' ? 'text-warn' : 'text-muted'}`}>{numbers[i]}</span>
            <span className="num flex-1 text-lg font-bold">{setLabel(s, kind)}</span>
            {s.rir !== undefined && <Chip size="sm">RIR {s.rir}</Chip>}
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

/** "W" for warm-ups, else 1..n counting working sets only. */
function setNumbers(sets: SetLog[]): (string | number)[] {
  let n = 0;
  return sets.map((s) => (s.type === 'warmup' ? 'W' : ++n));
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
