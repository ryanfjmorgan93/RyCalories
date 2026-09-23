import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { backupAfterSessionFinish } from '@/db/historySafety';
import { buildSummary, discardSession, finishSession, type SessionSummary, type SummaryItem } from '@/db/repo';
import { decisionLine, fmtDate, fmtDuration, fmtKg, fmtNum, fmtWeight } from '@/domain/format';
import { lockInBlocked, type Suggestion } from '@/domain/engine';
import type { PersonalRecord } from '@/domain/records';
import { NIGGLE_TAGS, type Niggle, type NiggleTag } from '@/domain/types';
import { sessionVolume } from '@/domain/volume';
import { useTimer } from '@/state/timer';
import { Button } from '@/ui/components/Button';
import { Card, SectionTitle } from '@/ui/components/Card';
import { Chip } from '@/ui/components/Chip';
import { NumberField, TextInput } from '@/ui/components/NumberField';
import { Confirm } from '@/ui/components/Sheet';
import { toast } from '@/ui/components/Toast';
import { TopBar } from '@/ui/components/TopBar';

interface Choice {
  mode: 'accept' | 'override';
  overrideTo: number | null;
  lockIn: boolean;
  lockInAt: number | null;
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** True once, for the life of this render, so a rebuild mid-session never replays the animation. */
function usePrefersReducedMotion(): boolean {
  const [reduced] = useState(prefersReducedMotion);
  return reduced;
}

/**
 * 0 → 1 once, cubic-out, over `durationMs` — the count-up progress for the hero figures. Starts
 * already at 1 under reduced motion (the lazy initial state), so the final values show
 * immediately with no visible count and no wasted animation frame.
 */
function useCountProgress(active: boolean, durationMs = 900): number {
  const [t, setT] = useState(() => (prefersReducedMotion() ? 1 : 0));
  useEffect(() => {
    if (!active || prefersReducedMotion()) {
      setT(1);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const linear = Math.min(1, (now - start) / durationMs);
      setT(1 - Math.pow(1 - linear, 3));
      if (linear < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [active, durationMs]);
  return t;
}

const CONFETTI_COLORS = ['var(--c-accent)', 'var(--c-ok)', 'var(--c-record)', 'var(--c-fg)', 'var(--c-info)'];

interface ConfettiPiece {
  leftPct: number;
  widthPx: number;
  heightPx: number;
  color: string;
  rotateDeg: number;
  driftPx: number;
  durMs: number;
  delayMs: number;
}

/** Deterministic, index-derived layout — no `Math.random()`, so a screenshot or a replay is stable. */
function buildConfetti(count = 24): ConfettiPiece[] {
  return Array.from({ length: count }, (_, i) => ({
    leftPct: (i * 37 + 11) % 100,
    widthPx: 6 + (i % 3) * 2,
    heightPx: 10 + (i % 4) * 3,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    rotateDeg: (i * 53) % 360,
    driftPx: ((i * 29) % 80) - 40,
    durMs: 1700 + ((i * 131) % 1200),
    delayMs: (i * 97) % 700,
  }));
}

export function SummaryScreen() {
  const { id } = useParams();
  const nav = useNavigate();
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [niggles, setNiggles] = useState<Niggle[]>([]);
  const [notes, setNotes] = useState('');
  const [checklist, setChecklist] = useState<{ electrolytes: boolean; protein: boolean }>({ electrolytes: false, protein: false });
  const [saving, setSaving] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  useEffect(() => {
    useTimer.getState().skip();
  }, []);

  useEffect(() => {
    let alive = true;
    if (!id) return;
    void buildSummary(id).catch(() => null).then((s) => {
      if (!alive) return;
      if (!s) {
        nav('/', { replace: true });
        return;
      }
      if (s.session.endedAt) {
        nav(`/history/${s.session.id}`, { replace: true });
        return;
      }
      setSummary(s);
      const init: Record<string, Choice> = {};
      for (const item of s.items) {
        if (!item.rx || !item.decision) continue;
        // A lock-in chosen mid-session (§2: the pending lock-in) takes precedence over
        // buildSummary's own suggestion — the user already decided; this only redisplays it. It
        // can still be switched off in favour of "Keep calibrating" below.
        const pending = s.session.lockIns?.[item.rx.id];
        init[item.rx.id] =
          pending !== undefined
            ? { mode: 'accept', overrideTo: item.decision.toWeight, lockIn: true, lockInAt: pending }
            : // A suggested lock-in weight seeds `lockIn: true` — locking a calibrating lift in is
              // the path of least resistance, not "Keep calibrating" (§5: the calibrating trap).
              { mode: 'accept', overrideTo: item.decision.toWeight, lockIn: item.lockIn !== null, lockInAt: item.lockIn?.suggested ?? null };
      }
      setChoices(init);
      setNiggles(s.session.niggles ?? []);
      setNotes(s.session.notes ?? '');
    });
    return () => {
      alive = false;
    };
  }, [id, nav]);

  const decided = useMemo(() => (summary?.items ?? []).filter((i) => i.status === 'done' && i.decision), [summary]);
  // Every Override / Lock in needs a number before the session can be saved — and for a weighted
  // lift that number cannot be 0. 0 is only meaningful for bodyweight_plus, where it means
  // bodyweight alone. `lockInBlocked` in engine.ts is the one floor, shared with
  // ExerciseDetailScreen's own lock-in sheet — this is the path taken at the end of every session.
  const invalid = decided.some((item) => {
    const c = choices[item.rx!.id];
    if (!c) return false;
    if (c.mode === 'override' && c.overrideTo === null) return true;
    if (!c.lockIn) return false;
    return lockInBlocked(c.lockInAt, item.exercise.kind);
  });
  const others = useMemo(() => (summary?.items ?? []).filter((i) => !(i.status === 'done' && i.decision)), [summary]);

  // The finish moment's three honest figures. kg lifted is computed here from the sets exactly as
  // logged — the same countsForVolume universe `summary.workingSetsDone` already counts sets over
  // — never from a decision or a prescription, so it can never flatter a session that under-shot.
  const allSets = useMemo(() => (summary?.items ?? []).flatMap((i) => i.sets), [summary]);
  const volumeKg = useMemo(() => sessionVolume(allSets), [allSets]);
  // Grouped by exercise: a single heavy set can beat weight, e1RM and set-volume all at once, and
  // repeating the exercise name for each would just make three truncated, near-identical rows.
  const heroRecords = useMemo(
    () => (summary?.items ?? []).filter((item) => item.records.length > 0).map((item) => ({ key: item.exercise.id, name: item.exercise.name, records: item.records })),
    [summary],
  );
  const reducedMotion = usePrefersReducedMotion();
  const revealT = useCountProgress(!!summary);
  const confettiPieces = useMemo(() => buildConfetti(), []);
  const [confettiDone, setConfettiDone] = useState(false);
  const summaryReady = !!summary;
  useEffect(() => {
    if (!summaryReady || reducedMotion) return;
    const maxMs = confettiPieces.reduce((m, p) => Math.max(m, p.delayMs + p.durMs), 0);
    const t = setTimeout(() => setConfettiDone(true), maxMs + 50);
    return () => clearTimeout(t);
  }, [summaryReady, reducedMotion, confettiPieces]);

  if (!summary) {
    return (
      <div>
        <TopBar title="Summary" back />
        <div className="px-4 py-8 text-muted">Working it out…</div>
      </div>
    );
  }

  const save = async () => {
    if (saving || invalid) return;
    setSaving(true);
    try {
      await finishSession(summary.session.id, {
        choices: Object.entries(choices).map(([rxId, c]) => ({
          routineExerciseId: rxId,
          overrideTo: c.mode === 'override' && c.overrideTo !== null ? c.overrideTo : undefined,
          lockInAt: c.lockIn && c.lockInAt !== null ? c.lockInAt : undefined,
        })),
        niggles,
        notes,
        checklist: summary.routine?.isLowerBody ? checklist : undefined,
      });
      // Fire-and-forget: must not slow down or block the finish flow.
      backupAfterSessionFinish();
      toast('Session saved', 'ok');
      nav('/', { replace: true });
    } catch {
      toast('Could not save', 'danger');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pb-safe">
      {!reducedMotion && !confettiDone && (
        <div aria-hidden="true" data-testid="summary-confetti" className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
          {confettiPieces.map((p, i) => (
            <span
              key={i}
              className="confetti-piece"
              style={
                {
                  left: `${p.leftPct}%`,
                  width: `${p.widthPx}px`,
                  height: `${p.heightPx}px`,
                  background: p.color,
                  '--confetti-rot': `${p.rotateDeg}deg`,
                  '--confetti-drift': `${p.driftPx}px`,
                  animationDuration: `${p.durMs}ms`,
                  animationDelay: `${p.delayMs}ms`,
                } as CSSProperties
              }
            />
          ))}
        </div>
      )}
      <TopBar title="Summary" subtitle={summary.session.title} back={`/session/${summary.session.id}`} />
      <div className="px-4">
        <div className="pt-1">
          <h1 className="truncate text-4xl font-extrabold leading-[0.95] tracking-tight">{summary.session.title}</h1>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="text-sm text-muted">{fmtDate(summary.session.startedAt, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
            {summary.session.deload && (
              <Chip tone="info" size="sm">
                Deload
              </Chip>
            )}
          </div>
        </div>

        {/* data-settled marks the end of the count-up, so a screenshot or test can wait for the final figures. */}
        <div className="mt-5 grid grid-cols-3 border-y border-line" data-testid="summary-hero" data-settled={revealT >= 1 ? 'true' : 'false'}>
          <HeroStat testId="summary-time" value={fmtDuration(summary.durationSec * revealT)} label="Time" />
          <HeroStat testId="summary-sets" value={String(Math.round(summary.workingSetsDone * revealT))} label="Sets" bordered />
          <HeroStat testId="summary-kg" value={fmtNum(Math.round(volumeKg * revealT))} label="kg lifted" bordered />
        </div>

        {heroRecords.length > 0 && (
          <div className="mt-5 flex flex-col gap-2">
            <h2 className="px-1 text-lg font-bold">Records</h2>
            {heroRecords.map(({ key, name, records }) => (
              <div key={key} data-testid="summary-record" className="flex items-start gap-3 rounded-xl border border-record/35 bg-record/10 px-3.5 py-3">
                <RecordIcon />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className="truncate font-semibold">{name}</span>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {records.map((r, i) => (
                      <span key={i} className="num shrink-0 text-sm font-bold text-record">
                        {recordChipLabel(r)}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {decided.length > 0 && <SectionTitle>Next time</SectionTitle>}
        <div className="grid gap-3">
          {decided.map((item) => (
            <DecisionCard
              key={item.rx!.id}
              item={item}
              choice={choices[item.rx!.id]}
              seededLockIn={summary.session.lockIns?.[item.rx!.id]}
              onChange={(c) => setChoices((prev) => ({ ...prev, [item.rx!.id]: c }))}
            />
          ))}
        </div>

        {others.length > 0 && (
          <>
            <SectionTitle>Also</SectionTitle>
            <Card>
              {others.map((item, i) => (
                <div key={item.rx?.id ?? `x:${item.exercise.id}`} className={`flex items-center justify-between px-4 py-3 ${i > 0 ? 'border-t border-line' : ''}`}>
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{item.exercise.name}</div>
                    <div className="text-sm text-muted">
                      {item.status === 'skipped' ? 'Skipped' : item.status === 'not_done' ? 'Not done' : item.status === 'extra' ? `${item.sets.length} sets · no progression (extra)` : ''}
                    </div>
                    {item.records.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {item.records.map((r, ri) => (
                          <Chip key={ri} size="sm" tone="ok">
                            {recordChipLabel(r)}
                          </Chip>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </Card>
          </>
        )}

        <SectionTitle>Niggles</SectionTitle>
        <Card className="p-4">
          <div className="flex flex-wrap gap-2">
            {NIGGLE_TAGS.map((tag) => {
              const on = niggles.some((n) => n.tag === tag);
              return (
                <Chip
                  key={tag}
                  tone={on ? 'danger' : 'neutral'}
                  active={on}
                  onClick={() => setNiggles((prev) => (on ? prev.filter((n) => n.tag !== tag) : [...prev, { tag, severity: 1 }]))}
                >
                  {tag}
                </Chip>
              );
            })}
          </div>
          {niggles.map((n) => (
            <NiggleRow key={n.tag} niggle={n} onChange={(next) => setNiggles((prev) => prev.map((x) => (x.tag === n.tag ? next : x)))} />
          ))}
        </Card>

        {summary.routine?.isLowerBody && (
          <>
            <SectionTitle>Leg day</SectionTitle>
            <Card className="px-4 py-1">
              <CheckRow label="Electrolytes (intra-workout)" checked={checklist.electrolytes} onChange={(v) => setChecklist((c) => ({ ...c, electrolytes: v }))} />
              <div className="h-px bg-line" />
              <CheckRow label="Protein 200 g today" checked={checklist.protein} onChange={(v) => setChecklist((c) => ({ ...c, protein: v }))} />
            </Card>
          </>
        )}

        <SectionTitle>Notes</SectionTitle>
        <TextInput value={notes} onChange={setNotes} placeholder="Optional" multiline />

        <div className="mt-6 grid gap-3">
          <Button size="xl" variant="primary" full onClick={() => void save()} disabled={saving || invalid} data-testid="save-session">
            Save session
          </Button>
          <Button size="md" variant="ghost" full onClick={() => setDiscardOpen(true)}>
            Discard session
          </Button>
        </div>
        <div className="h-8" />
      </div>

      <Confirm
        open={discardOpen}
        title="Discard this session?"
        body="Its sets will be deleted. Weights stay as they are."
        confirmLabel="Discard"
        danger
        onCancel={() => setDiscardOpen(false)}
        onConfirm={async () => {
          await discardSession(summary.session.id);
          nav('/', { replace: true });
          toast('Session discarded');
        }}
      />
    </div>
  );
}

function HeroStat({ value, label, bordered, testId }: { value: string; label: string; bordered?: boolean; testId?: string }) {
  return (
    <div className={`flex flex-col gap-0.5 py-4 ${bordered ? 'border-l border-line pl-3.5' : ''}`}>
      <span className="num text-4xl font-extrabold leading-none" data-testid={testId}>
        {value}
      </span>
      <span className="text-sm text-muted">{label}</span>
    </div>
  );
}

function RecordIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" className="mt-0.5 shrink-0 text-record">
      <circle cx="12" cy="14.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M8.6 9.6 6 3.5h4l2 4 2-4h4l-2.6 6.1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function DecisionCard({
  item,
  choice,
  seededLockIn,
  onChange,
}: {
  item: SummaryItem;
  choice: Choice | undefined;
  /** The weight the user locked this calibrating slot to during the live session (`session.lockIns`),
   * if any — distinct from `item.lockIn`, which is only ever a suggestion. Seeds the read-out
   * "N kg locked in" instead of the plain Keep-calibrating/Lock-in choice. */
  seededLockIn: number | undefined;
  onChange: (c: Choice) => void;
}) {
  const rx = item.rx!;
  const d = item.decision!;
  const kind = item.exercise.kind;
  const c: Choice = choice ?? { mode: 'accept', overrideTo: d.toWeight, lockIn: item.lockIn !== null, lockInAt: item.lockIn?.suggested ?? null };
  const isWeightDecision = d.rule === 'increase' || d.rule === 'hold' || d.rule === 'hold_missing_sets';
  // Chip and colour follow what actually happens to the prescription, not the rule name:
  // lifting below the prescribed weight can make an "increase" a net drop.
  const direction = !isWeightDecision ? 'none' : d.toWeight > d.fromWeight ? 'up' : d.toWeight < d.fromWeight ? 'down' : 'hold';
  const tone = direction === 'up' ? 'text-ok' : direction === 'down' ? 'text-warn' : 'text-fg';

  return (
    <Card className="p-4" data-testid={`decision-${item.exercise.name}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-lg font-extrabold">{item.exercise.name}</div>
          <div className={`num mt-0.5 text-base font-semibold ${tone}`} data-testid="decision-line">
            {decisionLine(d, kind)}
          </div>
        </div>
        {direction === 'up' && <Chip tone="ok" size="sm">up</Chip>}
        {direction === 'down' && <Chip tone="warn" size="sm">down</Chip>}
        {direction === 'hold' && <Chip size="sm">hold</Chip>}
        {d.rule === 'calibrating' && <Chip tone="info" size="sm">calibrating</Chip>}
        {d.rule === 'deload' && <Chip tone="info" size="sm">deload</Chip>}
      </div>

      {item.records.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {item.records.map((r, i) => (
            <Chip key={i} size="sm" tone="ok">
              {recordChipLabel(r)}
            </Chip>
          ))}
        </div>
      )}

      {item.suggestions.map((s, i) => (
        <SuggestionRow key={i} s={s} kind={kind} onUse={(w) => onChange({ ...c, mode: 'override', overrideTo: w })} />
      ))}

      {d.rule === 'deload' && (
        <div className="mt-3">
          <Button size="lg" full variant={c.mode === 'override' ? 'primary' : 'secondary'} onClick={() => onChange({ ...c, mode: 'override' })} data-testid="override">
            Override
          </Button>
          {c.mode === 'override' && (
            <div className="mt-2">
              <NumberField
                label={kind === 'bodyweight_plus' ? 'Added kg next time' : 'Next time (kg)'}
                value={c.overrideTo}
                onChange={(v) => onChange({ ...c, overrideTo: v })}
                step={rx.increment}
                testId="override-input"
              />
            </div>
          )}
        </div>
      )}

      {isWeightDecision && (
        <div className="mt-3">
          <div className="grid grid-cols-2 gap-2">
            <Button size="lg" variant={c.mode === 'accept' ? 'primary' : 'secondary'} onClick={() => onChange({ ...c, mode: 'accept' })} data-testid="accept">
              Accept {fmtWeight(kind, d.toWeight)}
            </Button>
            <Button size="lg" variant={c.mode === 'override' ? 'primary' : 'secondary'} onClick={() => onChange({ ...c, mode: 'override' })} data-testid="override">
              Override
            </Button>
          </div>
          {c.mode === 'override' && (
            <div className="mt-2">
              <NumberField
                label={kind === 'bodyweight_plus' ? 'Added kg next time' : 'Next time (kg)'}
                value={c.overrideTo}
                onChange={(v) => onChange({ ...c, overrideTo: v })}
                step={rx.increment}
                testId="override-input"
              />
            </div>
          )}
        </div>
      )}

      {d.rule === 'calibrating' && item.lockIn && (
        <div className="mt-3">
          {seededLockIn !== undefined && c.lockIn ? (
            // Already chosen during the live session — read it back rather than re-asking.
            <div className="flex items-center justify-between gap-3 rounded-xl border border-ok/40 bg-ok/10 px-3.5 py-3">
              <span className="num text-base font-bold text-ok" data-testid="lock-in">
                {fmtWeight(kind, c.lockInAt ?? seededLockIn)} locked in
              </span>
              <Button size="sm" variant="secondary" onClick={() => onChange({ ...c, lockIn: false })}>
                Keep calibrating
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Button size="lg" variant={!c.lockIn ? 'primary' : 'secondary'} onClick={() => onChange({ ...c, lockIn: false })}>
                Keep calibrating
              </Button>
              <Button size="lg" variant={c.lockIn ? 'primary' : 'secondary'} onClick={() => onChange({ ...c, lockIn: true })} data-testid="lock-in">
                Lock in
              </Button>
            </div>
          )}
          {c.lockIn && (
            <div className="mt-2">
              <NumberField label="Working weight (kg)" value={c.lockInAt} onChange={(v) => onChange({ ...c, lockInAt: v })} step={rx.increment} testId="lock-in-input" />
            </div>
          )}
        </div>
      )}

      {d.rule === 'not_applicable' && (
        <div className="mt-2 text-sm text-muted">
          {item.sets.length} {item.sets.length === 1 ? 'set' : 'sets'} logged
        </div>
      )}
    </Card>
  );
}

/** "PR weight 100 kg" · "PR e1RM 118 kg" · "PR set volume 800" · "PR reps 9 × 100 kg". */
function recordChipLabel(r: PersonalRecord): string {
  let base: string;
  switch (r.kind) {
    case 'weight':
      base = `PR weight ${fmtKg(r.value)}`;
      break;
    case 'e1rm':
      base = `PR e1RM ${fmtKg(r.value)}`;
      break;
    case 'set_volume':
      base = `PR set volume ${fmtNum(r.value)}`;
      break;
    case 'reps_at_weight':
      base = `PR reps ${fmtNum(r.value)} × ${fmtKg(r.weight)}`;
      break;
  }
  return r.previousSource === 'hevy' ? `${base} · beats Hevy` : base;
}

function SuggestionRow({ s, kind, onUse }: { s: Suggestion; kind: SummaryItem['exercise']['kind']; onUse: (w: number) => void }) {
  if (s.kind === 'double_increment') {
    return (
      <div className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-ok/40 bg-ok/10 px-3 py-2 text-sm">
        <span>
          Every set felt easy. Double increment: <b className="num">{fmtWeight(kind, s.toWeight)}</b>
        </span>
        <Button size="sm" variant="ok" onClick={() => onUse(s.toWeight)}>
          Use
        </Button>
      </div>
    );
  }
  if (s.kind === 'regression') {
    return (
      <div className="mt-2 rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-sm">
        <div>
          {s.setsBelowMin} sets below the rep range, two sessions running.
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Button size="sm" onClick={() => onUse(s.holdWeight)}>
            Hold {fmtWeight(kind, s.holdWeight)}
          </Button>
          <Button size="sm" onClick={() => onUse(s.dropWeight)}>
            Drop to {fmtWeight(kind, s.dropWeight)}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="mt-2 rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-sm">
      Stalled: {s.sessions} sessions at {fmtKg(s.weight)}.
    </div>
  );
}

function NiggleRow({ niggle, onChange }: { niggle: Niggle; onChange: (n: Niggle) => void }) {
  return (
    <div className="mt-3 border-t border-line pt-3">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-semibold">{niggle.tag}</span>
        {[1, 2, 3].map((sev) => (
          <Chip key={sev} size="lg" className="min-w-11 justify-center px-0" tone="danger" active={niggle.severity === sev} onClick={() => onChange({ ...niggle, severity: sev as 1 | 2 | 3 })}>
            {sev}
          </Chip>
        ))}
      </div>
      <div className="mt-2">
        <TextInput value={niggle.note ?? ''} onChange={(v) => onChange({ ...niggle, note: v })} placeholder={niggle.tag === ('other' as NiggleTag) ? 'What and where' : 'Note (optional)'} />
      </div>
    </div>
  );
}

function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} onClick={() => onChange(!checked)} className="flex min-h-14 w-full items-center gap-3 py-2 text-left">
      <span className={`flex h-7 w-7 items-center justify-center rounded-lg border-2 ${checked ? 'border-ok bg-ok text-ok-fg' : 'border-line'}`}>
        {checked && (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 13l4 4L19 7" />
          </svg>
        )}
      </span>
      <span className="font-semibold">{label}</span>
    </button>
  );
}

