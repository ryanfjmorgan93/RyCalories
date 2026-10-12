import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { db } from '@/db/db';
import { logBodyweight, startSession } from '@/db/repo';
import { dayView } from '@/db/todayQueries';
import { acknowledgeFilePickerNotice, dismissHistoryNotice, restoreHistoryNotice } from '@/db/historySafety';
import { isBackup, type Backup } from '@/db/backup';
import { useHistoryNoticeStore } from '@/state/historyNotice';
import { ZERO } from '@/domain/food';
import { fmtDateTime, fmtKg, fmtMinutes, fmtNum, plural } from '@/domain/format';
import { hasNoExercises, isConsecutiveLower } from '@/domain/schedule';
import { dateKeyToDate } from '@/domain/dates';
import { weeklyDelta, bandStatus } from '@/domain/bodyweight';
import type { Routine } from '@/domain/types';
import { Button } from '@/ui/components/Button';
import { Card, Divider, EmptyState, Row, SectionTitle, Stat } from '@/ui/components/Card';
import { Chip } from '@/ui/components/Chip';
import { NumberInput } from '@/ui/components/NumberField';
import { Sheet } from '@/ui/components/Sheet';
import { toast } from '@/ui/components/Toast';
import { ChevronIcon, TopBar } from '@/ui/components/TopBar';
import { QuickSessionSheet } from '@/ui/QuickSessionSheet';
import { RestoreSheet } from '@/ui/RestoreSheet';
import {
  useActiveSession,
  useCalendar,
  useLastCompletedSession,
  useNextRoutineContext,
  useRecentSessions,
  useRoutines,
  useSettings,
  useToday,
} from '@/ui/hooks';

export function HomeScreen() {
  const nav = useNavigate();
  const routines = useRoutines();
  const active = useActiveSession();
  const last = useLastCompletedSession();
  const rotation = useNextRoutineContext();
  const recent = useRecentSessions(3);
  const settings = useSettings();
  const [pending, setPending] = useState<Routine | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);

  const rxCounts = useLiveQuery(async () => {
    const all = await db.routineExercises.toArray();
    const m = new Map<string, number>();
    for (const rx of all) m.set(rx.routineId, (m.get(rx.routineId) ?? 0) + 1);
    return m;
  }, []);

  // From the hook, never a bare toDateKey(): nothing on this screen is time-driven, so a plain
  // render-time read freezes on the day the screen mounted. Left open overnight it would show
  // yesterday's calories as today's progress, against yesterday's target.
  const todayKey = useToday();
  const calendar = useCalendar(12, todayKey, settings);

  // A routine with no exercises has nothing to start; the buttons say so instead of opening an empty session.
  const empty = (r: Routine) => hasNoExercises(rxCounts, r.id);
  const exerciseCountText = (r: Routine) => (empty(r) ? 'No exercises' : `${rxCounts?.get(r.id) ?? 0} exercises`);

  const starting = useRef(false);
  const start = async (r: Routine) => {
    if (starting.current || empty(r)) return;
    if (rotation && isConsecutiveLower(routines ?? [], rotation.lastRoutineId, r.id, { lastWasLower: rotation.lastWasLower }) && pending?.id !== r.id) {
      setPending(r);
      return;
    }
    starting.current = true;
    try {
      const s = await startSession(r.id);
      setPending(null);
      nav(`/session/${s.id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not start', 'danger');
    } finally {
      starting.current = false;
    }
  };

  // One query for both halves of the day, shared with the Food screen so the two can never
  // disagree about the protein target.
  const view = useLiveQuery(async () => (settings ? dayView(todayKey, settings, todayKey) : undefined), [todayKey, settings]);
  const eaten = view?.eaten ?? ZERO;
  const kcal = view?.calories ?? null;
  const protein = view?.proteinTarget ?? null;

  return (
    <div>
      <TopBar
        title="Iron"
        subtitle={new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(dateKeyToDate(todayKey))}
      />
      <div className="px-4">
        <HistoryNoticeCard />

        {calendar && (
          <div className="mt-2 px-1 text-xs font-semibold text-muted" data-testid="streak-line">
            {calendar.streak > 0 ? `${calendar.streak} ${calendar.streak === 1 ? 'week' : 'weeks'} · ${calendar.line}` : `This week ${calendar.thisWeek} of ${calendar.weeklyTarget}`}
          </div>
        )}

        <SectionTitle right={<Button size="sm" variant="ghost" className="-mb-2 text-accent" onClick={() => nav('/routines')}>Edit</Button>}>Routines</SectionTitle>
        <Card data-testid="routines-list">
          {(routines ?? []).map((r, i) => (
            <div key={r.id}>
              {i > 0 && <Divider />}
              <Row
                onClick={() => nav(`/routines/${r.id}`)}
                title={r.name}
                subtitle={`${exerciseCountText(r)}${r.targetMinutes ? ` · ${r.targetMinutes} min` : ''}${r.isLowerBody ? ' · lower' : ''}`}
                right={
                  active ? (
                    <ChevronIcon />
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid={`start-${r.name}`}
                      disabled={empty(r)}
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

        {/* A short session needs no routine, so it is there with none. */}
        {!active && (
          <Button size="lg" variant="outline" full className="mt-3" onClick={() => setQuickOpen(true)} data-testid="short-session">
            Short session
          </Button>
        )}

        {settings && (kcal || protein !== null) && (
          // Eaten against target, and a tap through to the day. The targets alone were only ever
          // half the number worth knowing.
          <Card className="mt-3">
            <button type="button" onClick={() => nav('/food')} className="flex w-full items-center gap-6 px-4 py-3 text-left active:bg-surface-2" data-testid="today-food">
              {kcal ? (
                <Stat
                  label="Calories"
                  value={`${fmtNum(Math.round(eaten.kcal))} / ${fmtNum(kcal.kcal)}`}
                  sub={kcal.nextStepOn ? `+${settings.calorieStep} in ${kcal.daysUntilNextStep} d` : 'at ceiling'}
                />
              ) : (
                <Stat label="Calories" value={fmtNum(Math.round(eaten.kcal))} sub="no target set" />
              )}
              {protein !== null && (
                <Stat
                  label="Protein"
                  value={`${fmtNum(Math.round(eaten.protein))} / ${protein} g`}
                  sub={view?.legDay ? (view.legDayBasis === 'planned' ? 'lower-body planned' : 'lower-body day') : 'default'}
                />
              )}
            </button>
          </Card>
        )}

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

      <QuickSessionSheet open={quickOpen} onClose={() => setQuickOpen(false)} />

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
    </div>
  );
}

/**
 * "History that cannot be lost silently" (Phase 1). A fact and actions only — no explanation of
 * why it might have happened, per the no-lecturing rule. Reads src/state/historyNotice.ts, which
 * is seeded from localStorage at import time (src/db/historySafety.ts) and updated by the boot
 * check or by this card's own actions.
 */
function HistoryNoticeCard() {
  const notice = useHistoryNoticeStore((s) => s.notice);
  const setNotice = useHistoryNoticeStore((s) => s.setNotice);
  const [busy, setBusy] = useState(false);
  const [pickedBackup, setPickedBackup] = useState<Backup | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  if (!notice) return null;

  const dismiss = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await dismissHistoryNotice();
      setNotice(null);
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (busy || !notice.restoreCandidate) return;
    setBusy(true);
    try {
      const res = await restoreHistoryNotice(notice.restoreCandidate.filename);
      if (res.ok) {
        setNotice(null);
        toast('Restored', 'ok');
      } else {
        toast(res.error ?? 'Restore failed', 'danger');
      }
    } finally {
      setBusy(false);
    }
  };

  const onFilePicked = async (file: File | undefined) => {
    if (!file) return;
    let data: unknown;
    try {
      data = JSON.parse((await file.text()).replace(/^﻿/, ''));
    } catch {
      data = null;
    }
    if (!isBackup(data)) {
      toast('Not an Iron backup', 'danger');
      return;
    }
    setPickedBackup(data);
  };

  const counted = (sessions = 0, sets = 0) => `${plural(sessions, 'session')} · ${plural(sets, 'set')}`;
  const fact =
    notice.kind === 'loss'
      ? `Workout history dropped from ${counted(notice.fromSessions, notice.fromSets)} to ${counted(notice.toSessions, notice.toSets)} since the last start.`
      : notice.kind === 'fresh_install'
        ? `A backup from before this install exists: ${counted(notice.restoreCandidate?.sessions, notice.restoreCandidate?.sets)}.`
        : 'Backups on this device could not be listed.';

  return (
    <Card className="mt-2 border-danger/50 p-4" data-testid="history-notice">
      <div className="text-sm font-semibold" data-testid="history-notice-text">
        {fact}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        {notice.restoreCandidate ? (
          <Button size="lg" variant="primary" disabled={busy} onClick={() => void restore()} data-testid="history-notice-restore">
            Restore {fmtDateTime(notice.restoreCandidate.at)} · {plural(notice.restoreCandidate.sessions, 'session')}
          </Button>
        ) : (
          <Button size="lg" variant="primary" disabled={busy} onClick={() => fileInput.current?.click()} data-testid="history-notice-file">
            Restore from a file
          </Button>
        )}
        <Button size="lg" variant="outline" disabled={busy} onClick={() => void dismiss()} data-testid="history-notice-dismiss">
          Dismiss
        </Button>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          void onFilePicked(f);
        }}
      />
      <RestoreSheet
        backup={pickedBackup}
        open={pickedBackup !== null}
        onClose={() => setPickedBackup(null)}
        onRestored={() => {
          void acknowledgeFilePickerNotice();
          setNotice(null);
        }}
      />
    </Card>
  );
}

function BodyweightQuickAdd() {
  const settings = useSettings();
  const entries = useLiveQuery(() => db.bodyweight.orderBy('date').toArray(), []);
  const [kg, setKg] = useState<number | null>(null);
  const latest = entries && entries.length ? entries[entries.length - 1] : undefined;
  // Same rule as above: the hook, so the "Logged today" chip cannot go on asserting that
  // yesterday's reading is today's.
  const todayKey = useToday();
  const delta = entries ? weeklyDelta(entries, todayKey) : null;
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
          // Same floor BodyweightScreen applies to the identical action. logBodyweight does not
          // validate, and a 0 or negative reading feeds the weekly delta, the moving average and
          // the "to target" stat — a trend the owner reverse-diets against.
          disabled={kg === null || kg <= 0}
          onClick={async () => {
            if (kg === null || kg <= 0) return;
            await logBodyweight(todayKey, kg);
            setKg(null);
            toast(`Logged ${fmtKg(kg)}`, 'ok');
          }}
        >
          Log today
        </Button>
      </div>
      {latest && latest.date === todayKey && <div className="mt-2 text-xs text-muted"><Chip size="sm" tone="ok">Logged today</Chip></div>}
    </Card>
  );
}
