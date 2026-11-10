import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { loadQuickInput } from '@/db/quickQueries';
import { startQuickSession } from '@/db/quickRepo';
import { fmtRange, fmtWeight, plural } from '@/domain/format';
import {
  EMPTY_DRAFT,
  quickChips,
  quickOptions,
  removeExcluded,
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
import { generateQuickSession, ownQuickPlan, type QuickRow } from '@/domain/quickSession';
import { Button, IconButton } from './components/Button';
import { Chip, Segmented, Toggle } from './components/Chip';
import { TextInput } from './components/NumberField';
import { Sheet } from './components/Sheet';
import { toast } from './components/Toast';
import { ExercisePicker } from './ExercisePicker';
import { useSettings, useToday } from './hooks';

type Loaded = Awaited<ReturnType<typeof loadQuickInput>>;

/** The seed is drawn here, at the edge: the generator is pure and never reads a random source. */
function newSeed(): number {
  return Math.floor(Math.random() * 0x100000000);
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const slug = (s: string): string => s.replace(/\s+/g, '-');

/**
 * "3 × 10–15 · 32.5 kg", or "3 × 8–10 · no weight yet" when the owner has to pick it. A hold is its
 * seconds ("3 × 30–60 s") and a carry its walks ("3 walks · 30–40 m · 56 kg"): only the owner's own list has those.
 */
function prescriptionLine(row: QuickRow): string {
  const { kind } = row.candidate;
  if (kind === 'timed') return `${row.sets} × ${fmtRange(row.repMin, row.repMax, 's')}`;
  const weight = row.weightKg === null ? 'no weight yet' : fmtWeight(kind, row.weightKg);
  if (kind === 'carry') {
    const walk = row.distanceMinM !== undefined && row.distanceMaxM !== undefined ? ` · ${fmtRange(row.distanceMinM, row.distanceMaxM, 'm')}` : '';
    return `${plural(row.sets, 'walk')}${walk} · ${weight}`;
  }
  return `${row.sets} × ${fmtRange(row.repMin, row.repMax)} · ${weight}`;
}

type Mode = 'suggested' | 'own';

const MODES: { value: Mode; label: string; testId: string }[] = [
  { value: 'suggested', label: 'Suggested', testId: 'quick-mode-suggested' },
  { value: 'own', label: 'My own', testId: 'quick-mode-own' },
];

/**
 * A short session on demand. Suggested: a typed line and chips set the options, the plan is
 * previewed as it would be started, Shuffle draws another. My own: the owner picks the exercises,
 * each prescribed from their own numbers as a suggested one would be, in the order they were added.
 * Either way Start starts exactly what is shown, and nothing is written until Start, but for a
 * library exercise the owner picks: it becomes theirs at the pick, as it does wherever they pick one.
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
  const [mode, setMode] = useState<Mode>('suggested');
  // The owner's own list: exercise ids in the order they were added.
  const [ownIds, setOwnIds] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  // Counts the picks of an exercise the last read did not hold (one just taken from the library): each asks for another read.
  const [reads, setReads] = useState(0);

  const residue = useMemo(() => parseQuickRequest(draft.text).residue, [draft.text]);

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
  }, [settings, today, draft.includeNew, reads]);

  const own = mode === 'own';
  const plan = useMemo(
    () => (!loaded ? null : own ? ownQuickPlan(loaded.input, ownIds, options.effort) : generateQuickSession(loaded.input, options, seed)),
    [loaded, own, ownIds, options, seed],
  );
  // A pick still being read is not on screen yet, and Start starts exactly what is shown.
  const ready = plan !== null && plan.rows.length > 0 && (!own || plan.rows.length === ownIds.length);

  const change = (next: (d: QuickDraft) => QuickDraft) => setDraft((d) => next(d));

  const type = (text: string) => change((d) => typeText(d, text));

  const start = async () => {
    if (starting.current || !plan || !loaded || !ready) return;
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
  const unmet = plan && !own ? plan.unmet.filter((m) => chips.focus.muscles.includes(m)) : [];
  const short = !own && plan !== null && plan.rows.length > 0 && options.count !== undefined && plan.rows.length < options.count;

  return (
    <>
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
                  ) : own ? null : (
                    <div className="text-sm font-semibold text-warn" data-testid="quick-empty">
                      Nothing to choose from
                    </div>
                  )}
                  {!own && (
                    <Button size="sm" variant="outline" onClick={() => setSeed(newSeed())} data-testid="quick-shuffle">
                      Shuffle
                    </Button>
                  )}
                </div>
              </>
            )}
            <Button size="xl" variant="primary" full disabled={busy || !ready} onClick={() => void start()} data-testid="quick-start">
              Start
            </Button>
          </div>
        }
      >
        <Segmented value={mode} onChange={setMode} options={MODES} />

        {!own && (
          <>
            <label className="mt-4 block">
              <span className="block pb-2 label">Request</span>
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
          </>
        )}

        <Group label="Effort">
          {(['light', 'normal'] as const).map((effort) => (
            <Chip key={effort} size="lg" active={chips.effort === effort} pressed={chips.effort === effort} onClick={() => change((d) => tapEffort(d, effort))} testId={`quick-effort-${effort}`}>
              {cap(effort)}
            </Chip>
          ))}
        </Group>

        {!own && (
          <>
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

            {residue.length > 0 && (
              <div className="mt-3 text-sm text-muted" data-testid="quick-not-read">
                Not read: {residue.join(', ')}
              </div>
            )}
          </>
        )}

        <div className={`${own ? 'mt-4' : 'mt-2'} pb-2`}>
          {plan === null ? (
            <div className="text-sm text-muted" data-testid="quick-loading">
              Loading…
            </div>
          ) : (
            <div className="grid gap-2" data-testid="quick-preview" data-seed={plan.seed}>
              {plan.rows.map((row, i) => (
                <div key={row.candidate.id} className="rounded-xl border border-line bg-surface-2 px-3 py-2" data-testid={`quick-row-${i}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 break-words font-semibold">{row.candidate.name}</span>
                    {row.candidate.origin !== 'own' && (
                      <Chip size="sm" tone="info" testId={`quick-new-${i}`}>
                        New
                      </Chip>
                    )}
                    {own && (
                      <IconButton label={`Remove ${row.candidate.name}`} onClick={() => setOwnIds((ids) => ids.filter((id) => id !== row.candidate.id))} data-testid={`quick-remove-${i}`}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <path d="M6 6l12 12M18 6 6 18" />
                        </svg>
                      </IconButton>
                    )}
                  </div>
                  <div className="num text-sm">{prescriptionLine(row)}</div>
                  <div className="text-xs text-muted">
                    {row.candidate.muscleGroup} · {row.daysSince === null ? 'never' : `${row.daysSince} d`}
                  </div>
                </div>
              ))}
              {own && ownIds.length === 0 && (
                <div className="text-sm text-muted" data-testid="quick-own-empty">
                  No exercises yet
                </div>
              )}
              {own && (
                <Button full variant="outline" onClick={() => setPicking(true)} data-testid="quick-add">
                  Add exercise
                </Button>
              )}
            </div>
          )}
        </div>
      </Sheet>
      <ExercisePicker
        open={picking}
        onClose={() => setPicking(false)}
        exclude={ownIds}
        onPick={(exercise) => {
          setOwnIds((ids) => (ids.includes(exercise.id) ? ids : [...ids, exercise.id]));
          setPicking(false);
          // One just taken from the library was not among the exercises when they were read.
          if (!loaded?.input.candidates.some((c) => c.id === exercise.id)) setReads((n) => n + 1);
        }}
      />
    </>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-4">
      <div className="pb-2 label">{label}</div>
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
