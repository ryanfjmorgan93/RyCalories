import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { loadQuickInput } from '@/db/quickQueries';
import { startQuickSession } from '@/db/quickRepo';
import { fmtRange, fmtWeight, plural } from '@/domain/format';
import {
  aiFills,
  EMPTY_DRAFT,
  quickChips,
  quickOptions,
  removeExcluded,
  setAi,
  tapCount,
  tapEffort,
  tapEquipment,
  tapFocusAuto,
  tapIncludeNew,
  tapMinutes,
  toggleFocus,
  typeText,
  type QuickDraft,
} from '@/domain/quickDraft';
import { MACRO_MUSCLES, parseQuickRequest } from '@/domain/quickRequest';
import { generateQuickSession, type QuickRow } from '@/domain/quickSession';
import { useAssistant } from '@/state/assistant';
import { useQuickIntent } from '@/state/quickIntent';
import { Button } from './components/Button';
import { Chip, Toggle } from './components/Chip';
import { TextInput } from './components/NumberField';
import { Sheet } from './components/Sheet';
import { toast } from './components/Toast';
import { useSettings, useToday } from './hooks';

type Loaded = Awaited<ReturnType<typeof loadQuickInput>>;

/** What the owner's last tap on "Read with assistant" came to, for the text now in the box. */
type Reading = { kind: 'filled' } | { kind: 'nothing' } | { kind: 'error'; message: string };

/** The seed is drawn here, at the edge: the generator is pure and never reads a random source. */
function newSeed(): number {
  return Math.floor(Math.random() * 0x100000000);
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const slug = (s: string): string => s.replace(/\s+/g, '-');

/** "3 × 10–15 · 32.5 kg", or "3 × 8–10 · no weight yet" when the owner has to pick it. */
function prescriptionLine(row: QuickRow): string {
  const weight = row.weightKg === null ? 'no weight yet' : fmtWeight(row.candidate.kind, row.weightKg);
  return `${row.sets} × ${fmtRange(row.repMin, row.repMax)} · ${weight}`;
}

/**
 * A short session on demand: a typed line and chips set the options, the plan is previewed as it
 * would be started, Shuffle draws another, Start starts exactly what is shown. Nothing is written
 * until Start.
 */
export function QuickSessionSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Mounted only while open, so each opening starts from an empty request and a new seed.
  return open ? <QuickSessionBody onClose={onClose} /> : null;
}

function QuickSessionBody({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const settings = useSettings();
  const today = useToday();
  const [draft, setDraft] = useState<QuickDraft>(EMPTY_DRAFT);
  const [seed, setSeed] = useState(newSeed);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(false);
  const starting = useRef(false);

  const [reading, setReading] = useState<Reading | null>(null);
  const assistantStatus = useAssistant((s) => s.status);
  const refreshStatus = useAssistant((s) => s.refreshStatus);
  const intentBusy = useQuickIntent((s) => s.busy);
  // The draft as last rendered, for the assistant's answer to be checked against when it arrives.
  const latest = useRef(draft);
  useEffect(() => {
    latest.current = draft;
  });

  const residue = useMemo(() => parseQuickRequest(draft.text).residue, [draft.text]);
  const hasResidue = residue.length > 0;

  // The assistant's state is asked about once, the first time there is something the rules could not
  // read: not on opening, not on every keystroke, and nothing is sent to the model.
  const askedStatus = useRef(false);
  useEffect(() => {
    if (!hasResidue || askedStatus.current) return;
    askedStatus.current = true;
    void refreshStatus();
  }, [hasResidue, refreshStatus]);

  const options = useMemo(() => quickOptions(draft), [draft]);
  const chips = useMemo(() => quickChips(draft), [draft]);

  // Read once on opening, and again when the library is switched in or out: never live, so a
  // plan on screen cannot move under the owner's thumb.
  useEffect(() => {
    if (!settings) return;
    let stale = false;
    loadQuickInput({ today, settings, includeNew: draft.includeNew }).then(
      (result) => {
        if (!stale) setLoaded(result);
      },
      () => {
        if (!stale) toast('Could not read exercises', 'danger');
      },
    );
    return () => {
      stale = true;
    };
  }, [settings, today, draft.includeNew]);

  const plan = useMemo(() => (loaded ? generateQuickSession(loaded.input, options, seed) : null), [loaded, options, seed]);

  const change = (next: (d: QuickDraft) => QuickDraft) => setDraft((d) => next(d));

  // What the assistant read belongs to the text it read: typing drops it, and what it came to.
  const type = (text: string) => {
    setReading(null);
    change((d) => typeText(d, text));
  };

  /** One call to the model, on the tap: the typed text goes in once, and only options come back. */
  const readWithAssistant = async () => {
    const asked = draft.text;
    const result = await useQuickIntent.getState().read(asked);
    const now = latest.current;
    if (now.text !== asked) return; // the text it read is gone
    const { error } = useQuickIntent.getState();
    if (!result) {
      setReading(error ? { kind: 'error', message: error } : { kind: 'nothing' });
      return;
    }
    change((d) => setAi(d, result));
    setReading({ kind: aiFills(setAi(now, result)).length > 0 ? 'filled' : 'nothing' });
  };

  const start = async () => {
    if (starting.current || !plan || !loaded || plan.rows.length === 0) return;
    starting.current = true;
    setBusy(true);
    try {
      // Exactly the plan on screen: nothing is generated again here.
      const entries = plan.rows.some((r) => r.candidate.origin === 'catalogue') ? loaded.catalogueEntries : [];
      const demos = plan.rows.some((r) => r.candidate.origin === 'diagram') ? loaded.demos : [];
      const session = await startQuickSession(plan, entries, options.effort, demos);
      onClose();
      nav(`/session/${session.id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not start', 'danger');
    } finally {
      starting.current = false;
      setBusy(false);
    }
  };

  // Muscles named on their own: the ones a "No exercises for" line may speak of. A muscle that came
  // from a macro such as Upper is covered by that chip, and is not reported by name.
  const unmet = plan ? plan.unmet.filter((m) => chips.focus.muscles.includes(m)) : [];
  const short = plan !== null && plan.rows.length > 0 && options.count !== undefined && plan.rows.length < options.count;

  return (
    <Sheet
      open
      onClose={() => {
        if (!starting.current) onClose();
      }}
      title="Short session"
      footer={
        <div className="grid gap-2">
          {plan !== null && (
            <>
              {unmet.length > 0 && (
                <div className="text-sm font-semibold text-warn" data-testid="quick-unmet">
                  No exercises for {unmet.join(', ')}
                </div>
              )}
              {short && (
                <div className="text-sm font-semibold text-warn" data-testid="quick-short">
                  Only {plan.rows.length} available
                </div>
              )}
              <div className="flex items-center justify-between gap-3">
                {plan.rows.length > 0 ? (
                  <div className="num text-sm font-semibold" data-testid="quick-estimate">
                    about {plan.estimateMin} min · {plural(plan.rows.length, 'exercise')}
                  </div>
                ) : (
                  <div className="text-sm font-semibold text-warn" data-testid="quick-empty">
                    Nothing to choose from
                  </div>
                )}
                <Button size="sm" variant="outline" onClick={() => setSeed(newSeed())} data-testid="quick-shuffle">
                  Shuffle
                </Button>
              </div>
            </>
          )}
          <Button size="xl" variant="primary" full disabled={busy || !plan || plan.rows.length === 0} onClick={() => void start()} data-testid="quick-start">
            Start
          </Button>
        </div>
      }
    >
      <label className="block">
        <span className="block pb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Request</span>
        <TextInput value={draft.text} onChange={type} testId="quick-request" />
      </label>

      <Group label="Exercises">
        <Chip size="lg" active={chips.count.auto} pressed={chips.count.auto} onClick={() => change((d) => tapCount(d, null))} testId="quick-count-auto">
          Auto
        </Chip>
        {chips.count.values.map((n) => (
          <Chip key={n} size="lg" active={chips.count.selected === n} pressed={chips.count.selected === n} onClick={() => change((d) => tapCount(d, n))} testId={`quick-count-${n}`}>
            {n}
          </Chip>
        ))}
      </Group>

      <Group label="Effort">
        {(['light', 'normal'] as const).map((effort) => (
          <Chip key={effort} size="lg" active={chips.effort === effort} pressed={chips.effort === effort} onClick={() => change((d) => tapEffort(d, effort))} testId={`quick-effort-${effort}`}>
            {cap(effort)}
          </Chip>
        ))}
      </Group>

      <Group label="Time">
        {chips.minutes.values.map((m) => (
          <Chip key={m} size="lg" active={chips.minutes.selected === m} pressed={chips.minutes.selected === m} onClick={() => change((d) => tapMinutes(d, m))} testId={`quick-minutes-${m}`}>
            {m} min
          </Chip>
        ))}
      </Group>

      <Group label="Focus">
        <Chip size="lg" active={chips.focus.auto} pressed={chips.focus.auto} onClick={() => change(tapFocusAuto)} testId="quick-focus-auto">
          Auto
        </Chip>
        {chips.focus.macros.map(({ name, lit }) => (
          <Chip key={name} size="lg" active={lit} pressed={lit} onClick={() => change((d) => toggleFocus(d, MACRO_MUSCLES[name]))} testId={`quick-focus-${name}`}>
            {cap(name)}
          </Chip>
        ))}
        {chips.focus.muscles.map((m) => (
          <Chip key={m} size="lg" active pressed onClick={() => change((d) => toggleFocus(d, [m]))} testId={`quick-focus-${slug(m)}`}>
            {cap(m)} <Remove />
          </Chip>
        ))}
      </Group>

      {chips.excluded.length > 0 && (
        <Group label="Exclude">
          {chips.excluded.map((c) => (
            <Chip key={c.key} size="lg" tone="warn" active pressed onClick={() => change((d) => removeExcluded(d, c.key))} testId={`quick-exclude-${slug(c.key)}`}>
              No {c.label} <Remove />
            </Chip>
          ))}
        </Group>
      )}

      {chips.equipment.length > 0 && (
        <Group label="Equipment">
          {chips.equipment.map((c) => (
            <Chip key={c.label} size="lg" active pressed onClick={() => change((d) => tapEquipment(d, c))} testId={`quick-equipment-${slug(c.label)}`}>
              {cap(c.label)} <Remove />
            </Chip>
          ))}
        </Group>
      )}

      <Toggle checked={chips.includeNew} onChange={() => change(tapIncludeNew)} label="Include new" testId="quick-include-new" />

      {hasResidue && reading?.kind !== 'filled' && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className={`text-sm ${reading?.kind === 'error' ? 'font-semibold text-warn' : 'text-muted'}`} data-testid="quick-not-read">
            {reading?.kind === 'error' ? reading.message : reading?.kind === 'nothing' ? 'Nothing more read' : `Not read: ${residue.join(', ')}`}
          </div>
          {assistantStatus?.state === 'ready' && reading?.kind !== 'nothing' && (
            <Button size="sm" variant="ghost" disabled={intentBusy} onClick={() => void readWithAssistant()} data-testid="quick-read-assistant">
              {intentBusy ? 'Reading…' : 'Read with assistant'}
            </Button>
          )}
        </div>
      )}

      <div className="mt-2 pb-2">
        {plan === null ? (
          <div className="text-sm text-muted" data-testid="quick-loading">
            Loading…
          </div>
        ) : (
          <div className="grid gap-2" data-testid="quick-preview" data-seed={plan.seed}>
            {plan.rows.map((row, i) => (
              <div key={row.candidate.id} className="rounded-xl border border-line bg-surface-2 px-3 py-2" data-testid={`quick-row-${i}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-semibold">{row.candidate.name}</span>
                  {row.candidate.origin !== 'own' && (
                    <Chip size="sm" tone="info" testId={`quick-new-${i}`}>
                      New
                    </Chip>
                  )}
                </div>
                <div className="num text-sm">{prescriptionLine(row)}</div>
                <div className="text-xs text-muted">
                  {row.candidate.muscleGroup} · {row.daysSince === null ? 'never' : `${row.daysSince} d`}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-4">
      <div className="pb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted">{label}</div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

/** The mark on a chip that a tap takes away. */
function Remove() {
  return (
    <span aria-hidden className="opacity-60">
      ×
    </span>
  );
}
