import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { db } from '@/db/db';
import { discardSession, logBodyweight, startSession } from '@/db/repo';
import { fmtDateTime, fmtKg, fmtMinutes, fmtNum } from '@/domain/format';
import { calorieTargetOn, proteinTarget } from '@/domain/nutrition';
import { isConsecutiveLower, suggestNextRoutine } from '@/domain/schedule';
import { toDateKey } from '@/domain/dates';
import { useTimer } from '@/state/timer';
import { weeklyDelta, bandStatus } from '@/domain/bodyweight';
import type { Routine } from '@/domain/types';
import { Button } from '@/ui/components/Button';
import { Card, Divider, EmptyState, Row, SectionTitle, Stat } from '@/ui/components/Card';
import { Chip } from '@/ui/components/Chip';
import { NumberInput } from '@/ui/components/NumberField';
import { Confirm, Sheet } from '@/ui/components/Sheet';
import { toast } from '@/ui/components/Toast';
import { ChevronIcon, TopBar } from '@/ui/components/TopBar';
import { useActiveSession, useLastCompletedSession, useRecentSessions, useRoutines, useSettings } from '@/ui/hooks';

export function HomeScreen() {
  const nav = useNavigate();
  const routines = useRoutines();
  const active = useActiveSession();
  const last = useLastCompletedSession();
  const recent = useRecentSessions(3);
  const settings = useSettings();
  const [pickOpen, setPickOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [pending, setPending] = useState<Routine | null>(null);

  const rxCounts = useLiveQuery(async () => {
    const all = await db.routineExercises.toArray();
    const m = new Map<string, number>();
    for (const rx of all) m.set(rx.routineId, (m.get(rx.routineId) ?? 0) + 1);
    return m;
  }, []);

  const suggested = routines && last !== undefined ? suggestNextRoutine(routines, last?.routineId ?? null, { avoidConsecutiveLower: true }) : null;
  const todayKey = toDateKey();
  const todayRoutineLower = useLiveQuery(async () => {
    const start = todayKey;
    const todays = (await db.sessions.toArray()).filter((s) => s.startedAt.slice(0, 10) === start || toDateKey(new Date(s.startedAt)) === start);
    if (todays.length === 0) return null;
    const ids = [...new Set(todays.map((s) => s.routineId).filter(Boolean))];
    const rs = await db.routines.bulkGet(ids);
    return rs.some((r) => r?.isLowerBody);
  }, [todayKey]);

  const starting = useRef(false);
  const start = async (r: Routine) => {
    if (starting.current) return;
    if (last?.routineId && isConsecutiveLower(routines ?? [], last.routineId, r.id) && pending?.id !== r.id) {
      setPending(r);
      return;
    }
    starting.current = true;
    try {
      const s = await startSession(r.id);
      setPending(null);
      setPickOpen(false);
      nav(`/session/${s.id}`);
    } finally {
      starting.current = false;
    }
  };

  const kcal = settings ? calorieTargetOn(todayKey, settings) : null;
  const protein = settings ? proteinTarget(settings, todayRoutineLower ?? suggested?.isLowerBody ?? false) : null;

  return (
    <div>
      <TopBar title="Iron" subtitle={new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())} />
      <div className="px-4">
        {active && (
          <Card className="mt-2 border-accent/60 p-4">
            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-accent">Session in progress</div>
            <div className="mt-1 text-2xl font-extrabold">{active.title}</div>
            <div className="text-sm text-muted">Started {fmtDateTime(active.startedAt)}</div>
            <div className="mt-4 grid grid-cols-[1fr_auto] gap-3">
              <Button size="xl" variant="primary" onClick={() => nav(`/session/${active.id}`)} data-testid="resume-session">
                Resume
              </Button>
              <Button size="xl" variant="danger" onClick={() => setDiscardOpen(true)}>
                Discard
              </Button>
            </div>
          </Card>
        )}

        {!active && (
          <Card className="mt-2 p-4" data-testid="next-up">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Next up</div>
                {suggested ? (
                  <>
                    <div className="mt-1 truncate text-3xl font-extrabold leading-tight">{suggested.name}</div>
                    <div className="mt-1 text-sm text-muted">
                      {rxCounts?.get(suggested.id) ?? 0} exercises
                      {suggested.targetMinutes ? ` · target ${suggested.targetMinutes} min` : ''}
                      {suggested.isLowerBody ? ' · lower body' : ''}
                    </div>
                  </>
                ) : (
                  <div className="mt-1 text-lg text-muted">No routines yet</div>
                )}
              </div>
              {routines && routines.length > 1 && (
                <Button size="sm" variant="ghost" onClick={() => setPickOpen(true)} data-testid="change-routine">
                  Change
                </Button>
              )}
            </div>
            {suggested && (
              <Button size="xl" variant="primary" full className="mt-4" onClick={() => void start(suggested)} data-testid="start-session">
                Start
              </Button>
            )}
          </Card>
        )}

        {settings && (kcal || protein !== null) && (
          <Card className="mt-3 flex items-center gap-6 px-4 py-3">
            {kcal ? (
              <Stat label="Today" value={`${fmtNum(kcal.kcal)} kcal`} sub={kcal.nextStepOn ? `+${settings.calorieStep} in ${kcal.daysUntilNextStep} d` : 'at ceiling'} />
            ) : (
              <Stat label="Calories" value="—" sub="save Settings to start" />
            )}
            {protein !== null && <Stat label="Protein" value={`${protein} g`} sub={protein === settings.proteinTargetLegDay ? 'lower-body day' : 'default'} />}
          </Card>
        )}

        <SectionTitle right={<Button size="sm" variant="ghost" className="-mb-2 text-accent" onClick={() => nav('/routines')}>Edit</Button>}>Routines</SectionTitle>
        <Card>
          {(routines ?? []).map((r, i) => (
            <div key={r.id}>
              {i > 0 && <Divider />}
              <Row
                onClick={() => nav(`/routines/${r.id}`)}
                title={r.name}
                subtitle={`${rxCounts?.get(r.id) ?? 0} exercises${r.targetMinutes ? ` · ${r.targetMinutes} min` : ''}${r.isLowerBody ? ' · lower' : ''}`}
                right={
                  active ? (
                    <ChevronIcon />
                  ) : (
                    <Button
                      size="sm"
                      variant={suggested?.id === r.id ? 'primary' : 'outline'}
                      data-testid={`start-${r.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void start(r);
                      }}
                    >
                      Start
                    </Button>
                  )
                }
              />
            </div>
          ))}
          {routines && routines.length === 0 && <div className="p-4"><EmptyState>No routines. Add one from the Routines tab.</EmptyState></div>}
        </Card>

        <SectionTitle right={<Button size="sm" variant="ghost" className="-mb-2 text-accent" onClick={() => nav('/history')}>All</Button>}>Recent sessions</SectionTitle>
        <Card>
          {(recent ?? []).map((s, i) => (
            <div key={s.id}>
              {i > 0 && <Divider />}
              <Row
                onClick={() => nav(`/history/${s.id}`)}
                title={s.title}
                subtitle={`${fmtDateTime(s.startedAt)}${s.durationSec ? ` · ${fmtMinutes(s.durationSec)}` : ''}${s.source === 'hevy' ? ' · Hevy' : ''}`}
                right={<ChevronIcon />}
              />
            </div>
          ))}
          {recent && recent.length === 0 && <div className="p-4"><EmptyState>No sessions yet.</EmptyState></div>}
        </Card>

        <SectionTitle>Bodyweight</SectionTitle>
        <BodyweightQuickAdd />
        <div className="h-6" />
      </div>

      <Sheet open={pickOpen} onClose={() => setPickOpen(false)} title="Start which routine?">
        <div className="overflow-hidden rounded-xl border border-line">
          {(routines ?? []).map((r, i) => (
            <div key={r.id}>
              {i > 0 && <Divider />}
              <Row title={r.name} subtitle={`${rxCounts?.get(r.id) ?? 0} exercises${r.isLowerBody ? ' · lower' : ''}`} onClick={() => void start(r)} right={<ChevronIcon />} />
            </div>
          ))}
        </div>
      </Sheet>

      <Sheet open={pending !== null} onClose={() => setPending(null)} title="Two lower-body days in a row">
        <div className="text-muted">
          {last?.title ? `Last session was ${last.title}.` : ''} {pending?.name} is also lower body.
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Button size="lg" onClick={() => setPending(null)}>
            Pick another
          </Button>
          <Button size="lg" variant="primary" onClick={() => pending && void start(pending)}>
            Start anyway
          </Button>
        </div>
      </Sheet>

      <Confirm
        open={discardOpen}
        title="Discard this session?"
        body="Its sets will be deleted. Weights stay as they are."
        confirmLabel="Discard"
        danger
        onCancel={() => setDiscardOpen(false)}
        onConfirm={async () => {
          if (active) await discardSession(active.id);
          useTimer.getState().skip();
          setDiscardOpen(false);
          toast('Session discarded');
        }}
      />
    </div>
  );
}

function BodyweightQuickAdd() {
  const settings = useSettings();
  const entries = useLiveQuery(() => db.bodyweight.orderBy('date').toArray(), []);
  const [kg, setKg] = useState<number | null>(null);
  const latest = entries && entries.length ? entries[entries.length - 1] : undefined;
  const delta = entries ? weeklyDelta(entries, toDateKey()) : null;
  const status = delta && settings ? bandStatus(delta.deltaKg, settings.weeklyGainTargetMin, settings.weeklyGainTargetMax) : null;

  return (
    <Card className="p-4">
      <div className="flex items-end gap-4">
        <Stat label="Latest" value={latest ? fmtKg(latest.kg) : '—'} sub={latest ? latest.date : 'no readings'} />
        {delta && (
          <Stat
            label="7-day"
            value={`${delta.deltaKg > 0 ? '+' : ''}${fmtNum(delta.deltaKg)} kg`}
            tone={status === 'in' ? 'ok' : status === 'above' ? 'warn' : 'accent'}
            sub={settings ? `target +${settings.weeklyGainTargetMin}–${settings.weeklyGainTargetMax}` : undefined}
          />
        )}
      </div>
      <div className="mt-3 flex gap-2">
        <NumberInput value={kg} onChange={setKg} placeholder={latest ? fmtNum(latest.kg) : 'kg'} testId="bw-input" />
        <Button
          variant="primary"
          disabled={kg === null}
          onClick={async () => {
            if (kg === null) return;
            await logBodyweight(toDateKey(), kg);
            setKg(null);
            toast(`Logged ${fmtKg(kg)}`, 'ok');
          }}
        >
          Log today
        </Button>
      </div>
      {latest && latest.date === toDateKey() && <div className="mt-2 text-xs text-muted"><Chip size="sm" tone="ok">Logged today</Chip></div>}
    </Card>
  );
}
