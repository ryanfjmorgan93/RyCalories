import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { macrosOf } from '@/domain/food';
import { fmtDayKey, fmtGrams, fmtKcal } from '@/domain/format';
import { addDays } from '@/domain/dates';
import { memoryKey, normalise } from '@/domain/foodMemory';
import {
  amountPlan,
  choiceFromLabel,
  choiceFromMemory,
  itemFromAmount,
  kcalFor,
  recentChoices,
  searchChoices,
  type FoodChoice,
} from '@/domain/foodChoice';
import { amountChips, chipGrams, portionText, type AmountChip, type UnitOption } from '@/domain/foodUnits';
import { defaultSlot } from '@/domain/mealSlot';
import { barcodeDigits, displayName, type LabelNutrition } from '@/domain/products';
import { MEAL_SLOTS, type FoodMemory, type MealSlot } from '@/domain/types';
import { allFoods, logItemToSlot, undoLoggedItems, type LoggedItems, type NewMealItem } from '@/db/foodRepo';
import { lookupBarcode, lookupName } from '@/db/productRepo';
import { loadUkFoodTable, type UkFoodTable } from '@/data/ukFoodTable';
import { BarcodeScanner } from './BarcodeScanner';
import { FoodItemSheet } from './FoodItemSheet';
import { Button, IconButton } from './components/Button';
import { Card, Divider, EmptyState, Row } from './components/Card';
import { Chip, Segmented } from './components/Chip';
import { NumberField, NumberInput, TextInput } from './components/NumberField';
import { Sheet } from './components/Sheet';
import { toast } from './components/Toast';
import { BackIcon, ChevronIcon } from './components/TopBar';
import { useSettings, useToday } from './hooks';

/** What a hook (photo, describe, snap the label) is told about where the food is going. */
export interface AddFoodContext {
  date: string;
  slot: MealSlot;
}

/**
 * The one place to add food. Search what has been eaten before and the bundled UK table (and, on a
 * tap, Open Food Facts by name), or scan a barcode; pick a result and the amount step offers the
 * food in its own units — "Whole pack (400 g) · Half · Some", "2 eggs" — and one tap logs it
 * straight to the day's meal for the chosen slot, with an Undo.
 *
 * `onPhoto`, `onDescribe` and `onSnapLabel` are the hooks for the Claude-backed readers. Each
 * button is rendered only when its handler is passed. The sheet closes after calling one: the
 * handler owns what follows (the camera, the answer, the log), and logs through
 * `logItemsToSlot(ctx.date, ctx.slot, items)` so the photo and the chip write the same kind of item.
 * A handler that cannot start (no key, no signal) returns `false` to keep the sheet open under its
 * explanation. `onSnapLabel` is offered only on the unknown-barcode screen.
 *
 * `slot` and `start` reopen the sheet where a reader left off: on the slot already chosen, and, for
 * a label Claude has just read, straight on the amount step ("Whole pack · Half · Some").
 */
export function AddFoodSheet({
  date,
  slot: startSlot,
  start,
  onClose,
  onPhoto,
  onDescribe,
  onSnapLabel,
  onLogged,
}: {
  date: string;
  /** The slot to open on, when the sheet is reopened by a reader; otherwise the clock decides. */
  slot?: MealSlot;
  /** A label to open on the amount step of, e.g. one Claude has just read from a photo. */
  start?: LabelNutrition;
  onClose: () => void;
  onPhoto?: (ctx: AddFoodContext) => void | false;
  onDescribe?: (ctx: AddFoodContext) => void | false;
  onSnapLabel?: (ctx: AddFoodContext & { barcode?: string }) => void | false;
  /** After an item is logged, before the sheet closes. */
  onLogged?: (logged: LoggedItems, item: NewMealItem) => void;
}) {
  const today = useToday();
  // Off means off: no request is made at all, and no button for one. The barcode scan is the same
  // lookup, so it goes with it.
  const lookupEnabled = useSettings()?.productLookup !== false;
  const online = useOnline();

  const [slot, setSlot] = useState<MealSlot>(() => startSlot ?? defaultSlot());
  const [step, setStep] = useState<Step>(() => (start ? { kind: 'amount', choice: choiceFromLabel(start) } : { kind: 'search' }));
  const [q, setQ] = useState('');
  const deferredQ = useDeferredValue(q);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [typing, setTyping] = useState<Typing | null>(null);
  const [onlineState, setOnlineState] = useState<'idle' | 'searching' | 'none' | 'unavailable'>('idle');
  const [scanning, setScanning] = useState(false);
  const requestRef = useRef(0);
  // Latched before the write: logging mints new ids on every call, so a second tap would log twice.
  const loggingRef = useRef(false);

  const memories = useLiveQuery(() => allFoods(), []) ?? NO_FOODS;
  const [table, setTable] = useState<UkFoodTable | null>(null);
  useEffect(() => {
    // Lazily, on first open: the table is ~2,850 rows and is no part of the app's first paint.
    let live = true;
    loadUkFoodTable()
      .then((t) => live && setTable(t))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const results = useMemo(() => {
    const sources = { foods: table?.foods ?? [], aliases: table?.aliases ?? [] };
    return deferredQ.trim() ? searchChoices(deferredQ, { ...sources, memories }, 12) : recentChoices(memories, sources, 8);
  }, [deferredQ, memories, table]);

  const ctx: AddFoodContext = { date, slot };

  /** Log one item to the day and say so. The sheet closes whether or not the toast is reached. */
  const log = async (item: NewMealItem) => {
    if (loggingRef.current) return;
    loggingRef.current = true;
    try {
      const logged = await logItemToSlot(date, slot, item);
      const kcal = Math.round(macrosOf(item.nutrition).kcal);
      onLogged?.(logged, item);
      toast(`Logged to ${slot[0]!.toUpperCase()}${slot.slice(1)} · ${kcal} kcal`, 'neutral', {
        label: 'Undo',
        onClick: () => {
          undoLoggedItems(logged)
            .then(() => toast('Removed'))
            .catch(() => toast('Could not undo', 'danger'));
        },
      });
      onClose();
    } catch {
      loggingRef.current = false;
      toast('Could not log that', 'danger');
    }
  };

  /** A label (or a remembered food) found for a name or a scan, as the next step. */
  const pickLabel = (label: LabelNutrition) => {
    const probe = choiceFromLabel(label);
    const known = memories.find((m) => m.key === memoryKey(probe));
    setStep({ kind: 'amount', choice: choiceFromLabel(label, known) });
  };

  const lookUpOnline = async () => {
    const text = q.trim();
    if (!text || onlineState === 'searching') return;
    const ticket = (requestRef.current += 1);
    setOnlineState('searching');
    try {
      const result = await lookupName({ text });
      if (ticket !== requestRef.current) return;
      if (result.label) {
        setOnlineState('idle');
        pickLabel(result.label);
      } else {
        setOnlineState(result.from === 'network' || result.from === 'cache' ? 'none' : 'unavailable');
      }
    } catch {
      if (ticket === requestRef.current) setOnlineState('unavailable');
    }
  };

  const onScanCode = async (code: string) => {
    setScannerOpen(false);
    const ticket = (requestRef.current += 1);
    setScanning(true);
    const digits = barcodeDigits(code) ?? undefined;
    try {
      const result = await lookupBarcode(code);
      if (ticket !== requestRef.current) return;
      setScanning(false);
      if (result.from === 'memory' && result.memory) {
        // Typed in against this pack before: the owner's own entry, units and all.
        setStep({ kind: 'amount', choice: choiceFromMemory(result.memory) });
      } else if (result.label) {
        pickLabel(result.label);
      } else {
        const reason: MissReason = result.partial
          ? 'nofigures'
          : result.from === 'invalid'
            ? 'invalid'
            : result.from === 'offline'
              ? 'offline'
              : result.from === 'network' || result.from === 'cache'
                ? 'notfound'
                : 'unavailable';
        setStep({ kind: 'missed', reason, ...(digits ? { barcode: digits } : {}), ...(result.partial ? { partial: result.partial } : {}) });
      }
    } catch {
      if (ticket === requestRef.current) {
        setScanning(false);
        setStep({ kind: 'missed', reason: 'unavailable', ...(digits ? { barcode: digits } : {}) });
      }
    }
  };

  /** Hand over to a Claude-backed reader, which owns everything from here (unless it declines to start). */
  const handOff = (handler: (c: AddFoodContext) => void | false) => {
    if (handler(ctx) !== false) onClose();
  };

  const hooks = [onPhoto, onDescribe].filter(Boolean).length;

  return (
    <>
      <Sheet open onClose={onClose} title="Add food">
        <div className="grid gap-4" data-testid="add-food-sheet">
          <div className="grid gap-2">
            <div className="flex items-baseline justify-between px-1">
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Log to</span>
              <span className="text-xs text-muted" data-testid="add-food-day">
                {fmtDayKey(date, today, addDays(today, -1))}
              </span>
            </div>
            <Segmented<MealSlot>
              value={slot}
              onChange={setSlot}
              options={MEAL_SLOTS.map((s) => ({ value: s, label: s[0]!.toUpperCase() + s.slice(1), testId: `slot-${s}` }))}
            />
          </div>

          {step.kind === 'search' && (
            <>
              <TextInput value={q} onChange={(v) => { setQ(v); setOnlineState('idle'); }} placeholder="Search for a food" testId="add-food-search" />

              <div className={`grid gap-2 ${gridCols(1 + hooks)}`}>
                {lookupEnabled && (
                  <Button size="md" variant="outline" full disabled={scanning} onClick={() => setScannerOpen(true)} data-testid="add-food-scan">
                    {scanning ? 'Looking up…' : 'Barcode'}
                  </Button>
                )}
                {onPhoto && (
                  <Button size="md" variant="outline" full onClick={() => handOff(onPhoto)} data-testid="add-food-photo">
                    Camera
                  </Button>
                )}
                {onDescribe && (
                  <Button size="md" variant="outline" full onClick={() => handOff(onDescribe)} data-testid="add-food-describe">
                    Describe
                  </Button>
                )}
              </div>

              <div data-testid="add-food-results">
                {results.length > 0 ? (
                  <>
                    {!deferredQ.trim() && (
                      <div className="mb-2 px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Recent</div>
                    )}
                    <Card>
                      {results.map((c, i) => (
                        <div key={c.key}>
                          {i > 0 && <Divider />}
                          <Row
                            onClick={() => setStep({ kind: 'amount', choice: c })}
                            testId={`result-${c.name}`}
                            title={c.name}
                            subtitle={<ResultLine choice={c} />}
                            right={<ChevronIcon className="mr-1 text-muted" />}
                          />
                        </div>
                      ))}
                    </Card>
                  </>
                ) : (
                  <EmptyState>{deferredQ.trim() ? 'Nothing found.' : lookupEnabled ? 'Type a food or scan a barcode.' : 'Type a food.'}</EmptyState>
                )}
              </div>

              {lookupEnabled && online && q.trim().length >= 3 && (
                <div className="grid gap-1">
                  <Button size="md" variant="outline" full disabled={onlineState === 'searching'} onClick={() => void lookUpOnline()} data-testid="add-food-online">
                    {onlineState === 'searching' ? 'Looking up…' : 'Search online'}
                  </Button>
                  {onlineState === 'none' && (
                    <div className="px-1 text-xs text-muted" data-testid="add-food-online-none">
                      No matching product.
                    </div>
                  )}
                  {onlineState === 'unavailable' && (
                    <div className="px-1 text-xs text-muted" data-testid="add-food-online-unavailable">
                      Lookup unavailable.
                    </div>
                  )}
                </div>
              )}

              <Button size="md" variant="ghost" full onClick={() => setTyping({ title: 'Type it in', ...(q.trim() ? { name: q.trim() } : {}) })} data-testid="add-by-hand">
                Type it in
              </Button>
            </>
          )}

          {step.kind === 'amount' && (
            <AmountStep key={step.choice.key} choice={step.choice} onBack={() => setStep({ kind: 'search' })} onLog={(item) => void log(item)} />
          )}

          {step.kind === 'missed' && (
            <MissedStep
              miss={step}
              onBack={() => setStep({ kind: 'search' })}
              onType={() =>
                setTyping({
                  title: 'Type the label',
                  ...(step.partial ? { name: displayName({ brand: step.partial.brand ?? '', name: step.partial.name }), product: step.partial.name } : {}),
                  ...(step.partial?.brand ? { brand: step.partial.brand } : {}),
                  ...(step.barcode ? { barcode: step.barcode } : {}),
                })
              }
              onScanAgain={() => setScannerOpen(true)}
              onSnap={onSnapLabel ? () => handOff(() => onSnapLabel({ ...ctx, ...(step.barcode ? { barcode: step.barcode } : {}) })) : undefined}
            />
          )}
        </div>
      </Sheet>

      <BarcodeScanner open={scannerOpen} onClose={() => setScannerOpen(false)} onCode={(code) => void onScanCode(code)} />

      {typing && (
        <FoodItemSheet
          key={`${typing.name ?? ''}|${typing.barcode ?? ''}`}
          open
          title={typing.title}
          prefill={typing}
          onClose={() => setTyping(null)}
          onSave={(item) => {
            setTyping(null);
            void log(item);
          }}
        />
      )}
    </>
  );
}

const NO_FOODS: FoodMemory[] = [];

type MissReason = 'notfound' | 'nofigures' | 'offline' | 'unavailable' | 'invalid';

type Step =
  | { kind: 'search' }
  | { kind: 'amount'; choice: FoodChoice }
  | { kind: 'missed'; reason: MissReason; barcode?: string; partial?: { name: string; brand?: string } };

interface Typing {
  /** The sheet's heading: "Type the label" after a scan found nothing, "Type it in" otherwise. */
  title: string;
  name?: string;
  brand?: string;
  product?: string;
  barcode?: string;
}

function gridCols(n: number): string {
  return n >= 3 ? 'grid-cols-3' : n === 2 ? 'grid-cols-2' : 'grid-cols-1';
}

/** Whether the device thinks it has a connection, kept current. */
function useOnline(): boolean {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

const SOURCE_NOTE: Record<FoodChoice['source'], string> = {
  label: 'Label',
  table: 'UK table',
  user: 'Your figures',
  memory: 'Remembered',
  model: '≈ Estimate',
};

/** "165 kcal / 100 g · UK table" — what a result row says about itself. */
function ResultLine({ choice }: { choice: FoodChoice }) {
  const { options } = amountPlan(choice);
  const pack = options.find((o) => o.kind === 'pack');
  const item = options.find((o) => o.kind === 'item');
  const brand = choice.brand && !normalise(choice.name).includes(normalise(choice.brand)) ? choice.brand : '';
  const parts = [
    brand,
    `${fmtKcal(choice.per100.kcal)} / 100 g`,
    pack ? `${fmtGrams(pack.grams)} pack` : item ? `${item.noun} ${choice.source === 'table' ? '≈ ' : ''}${fmtGrams(item.grams)}` : '',
  ].filter(Boolean);
  return <span className="num">{parts.join(' · ')}</span>;
}

// ---------------------------------------------------------------------------
// The amount step

type Panel = 'none' | 'some' | 'grams';

/**
 * A food and the ways to eat it: one tap on a chip logs it. "Some" and "Grams" open a field
 * instead, because those need a number, and log with a button of their own.
 */
function AmountStep({ choice, onBack, onLog }: { choice: FoodChoice; onBack: () => void; onLog: (item: NewMealItem) => void }) {
  const plan = useMemo(() => amountPlan(choice), [choice]);
  const countable = plan.options.filter((o) => o.kind !== 'grams');
  const [unitKey, setUnitKey] = useState(plan.unit.key);
  const unit = plan.options.find((o) => o.key === unitKey) ?? plan.unit;
  const [panel, setPanel] = useState<Panel>('none');
  const chips = amountChips(unit);
  const logQty = (u: UnitOption, qty: number) => onLog(itemFromAmount(choice, u, qty, plan.options));
  /** A weight typed in grams is the grams unit with that many of it. */
  const gramsUnit = plan.options.find((o) => o.kind === 'grams')!;
  const logGrams = (grams: number) => onLog(itemFromAmount(choice, { ...gramsUnit, grams: 1 }, grams, plan.options));

  const buttons: Array<{ id: string; label: string; detail?: string; active?: boolean; onClick: () => void; testId: string }> = [
    ...chips.map((c) => ({
      id: c.id,
      label: c.label,
      detail: chipDetail(choice, unit, c),
      onClick: () => logQty(unit, c.qty),
      testId: `amount-${c.id}`,
    })),
    { id: 'some', label: 'Some', active: panel === 'some', onClick: () => setPanel(panel === 'some' ? 'none' : 'some'), testId: 'amount-some' },
    // A weight can always be typed; for the grams unit "Some" already is that.
    ...(unit.kind !== 'grams'
      ? [{ id: 'grams', label: 'Grams', active: panel === 'grams', onClick: () => setPanel(panel === 'grams' ? 'none' : 'grams'), testId: 'amount-grams' }]
      : []),
  ];

  const m = choice.per100;
  return (
    <div className="grid gap-4" data-testid="amount-step">
      <div className="flex items-start gap-2">
        <IconButton label="Back to search" onClick={onBack} data-testid="amount-back" className="-ml-2">
          <BackIcon />
        </IconButton>
        <div className="min-w-0 flex-1 pt-1.5">
          <div className="text-lg font-bold leading-tight" data-testid="amount-name">
            {choice.name}
          </div>
          <div className="num mt-1 text-sm text-muted">
            {fmtKcal(m.kcal)} · P {Math.round(m.protein)} · C {Math.round(m.carbs)} · F {Math.round(m.fat)} per 100 g
          </div>
          <div className="mt-0.5 text-xs text-dim">{SOURCE_NOTE[choice.source]}</div>
        </div>
      </div>

      {countable.length > 1 && (
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Count in">
          {countable.map((o) => (
            <Chip key={o.key} size="lg" active={o.key === unit.key} onClick={() => { setUnitKey(o.key); setPanel('none'); }} testId={`unit-${o.key}`}>
              {o.label[0]!.toUpperCase() + o.label.slice(1)}
            </Chip>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {/* The default amount spans the row. The rest pair up, and an odd one out spans a row of its
            own rather than sitting alone beside a gap. */}
        {buttons.map((b, i) => (
          <AmountButton
            key={b.id}
            primary={i === 0}
            wide={i === 0 || (i === buttons.length - 1 && buttons.length % 2 === 0)}
            label={b.label}
            detail={b.detail}
            active={b.active}
            onClick={b.onClick}
            testId={b.testId}
          />
        ))}
      </div>

      {panel === 'some' && <SomePanel choice={choice} unit={unit} gramsUnit={gramsUnit} onLogQty={logQty} onLogGrams={logGrams} />}
      {panel === 'grams' && <GramsPanel choice={choice} start={Math.round(unit.kind === 'grams' ? unit.grams : 100)} onLog={logGrams} />}
    </div>
  );
}

/**
 * What sits under a chip's label: the weight (unless the label already says it) and the
 * kilocalories. One egg's weight is the app's estimate, so a count-based weight carries "≈".
 */
function chipDetail(choice: FoodChoice, unit: UnitOption, chip: AmountChip): string {
  const kcal = fmtKcal(kcalFor(choice, chip.grams));
  if (/\d\s?g\b/.test(chip.label)) return kcal;
  return `${unit.kind === 'item' ? '≈ ' : ''}${fmtGrams(chip.grams)} · ${kcal}`;
}

function AmountButton({
  label,
  detail,
  onClick,
  primary,
  wide,
  active,
  testId,
}: {
  label: string;
  detail?: string;
  onClick: () => void;
  primary?: boolean;
  wide?: boolean;
  active?: boolean;
  testId: string;
}) {
  const look = primary
    ? 'fill-highlight bg-accent text-accent-fg'
    : active
      ? 'border border-fg bg-fg text-bg'
      : 'border border-line bg-surface-2 text-fg';
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`flex min-h-14 select-none flex-col items-center justify-center rounded-control px-3 py-2 text-center active:brightness-90 ${wide ? 'col-span-2' : ''} ${look}`}
    >
      <span className="text-base font-bold leading-tight">{label}</span>
      {detail && <span className="num text-xs leading-tight opacity-80">{detail}</span>}
    </button>
  );
}

/** A live line under an input: what the amount comes to, so the figure being logged is never a surprise. */
function Preview({ choice, grams, text }: { choice: FoodChoice; grams: number; text?: string }) {
  return (
    <div className="num flex items-baseline justify-between rounded-xl bg-surface-2 px-3 py-3 text-sm" data-testid="amount-preview">
      <span className="text-muted">{text ?? fmtGrams(grams)}</span>
      <span className="font-extrabold tabular-nums">
        {text ? `${fmtGrams(grams)} · ` : ''}
        {fmtKcal(kcalFor(choice, grams))}
      </span>
    </div>
  );
}

/**
 * "Some": a share of a pack on a slider, or a count of servings or items to step to. For the grams
 * unit it is simply the weight.
 */
function SomePanel({
  choice,
  unit,
  gramsUnit,
  onLogQty,
  onLogGrams,
}: {
  choice: FoodChoice;
  unit: UnitOption;
  gramsUnit: UnitOption;
  onLogQty: (u: UnitOption, qty: number) => void;
  onLogGrams: (grams: number) => void;
}) {
  if (unit.kind === 'grams') return <GramsPanel choice={choice} start={gramsUnit.grams} onLog={onLogGrams} />;
  if (unit.kind === 'pack') return <ShareOfPack choice={choice} unit={unit} onLog={(qty) => onLogQty(unit, qty)} />;
  return <CountOf choice={choice} unit={unit} onLog={(qty) => onLogQty(unit, qty)} />;
}

function ShareOfPack({ choice, unit, onLog }: { choice: FoodChoice; unit: UnitOption; onLog: (qty: number) => void }) {
  const [pct, setPct] = useState(25);
  const qty = pct / 100;
  return (
    <div className="grid gap-3" data-testid="some-panel">
      <label className="grid gap-2">
        <span className="px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">How much of the {unit.noun}</span>
        <input
          type="range"
          min={5}
          max={100}
          step={5}
          value={pct}
          onChange={(e) => setPct(Number(e.target.value))}
          data-testid="some-slider"
          aria-label={`Share of the ${unit.noun}, per cent`}
          className="h-11 w-full accent-accent"
        />
      </label>
      <Preview choice={choice} grams={chipGrams(unit, qty)} text={`${pct}% of the ${unit.noun}`} />
      <Button size="lg" variant="primary" full onClick={() => onLog(qty)} data-testid="amount-log">
        Log
      </Button>
    </div>
  );
}

function CountOf({ choice, unit, onLog }: { choice: FoodChoice; unit: UnitOption; onLog: (qty: number) => void }) {
  const [qty, setQty] = useState<number | null>(unit.kind === 'serving' ? 3 : unit.grams < 60 ? 4 : 3);
  const n = qty ?? 0;
  return (
    <div className="grid gap-3" data-testid="some-panel">
      <NumberField
        value={qty}
        onChange={setQty}
        step={unit.kind === 'serving' ? 0.5 : 1}
        min={0}
        max={99}
        label={unit.nouns[0]!.toUpperCase() + unit.nouns.slice(1)}
        testId="some-count"
      />
      <Preview choice={choice} grams={chipGrams(unit, n)} text={n > 0 ? portionText(unit, n).replace(/ \([^)]*\)$/, '') : undefined} />
      <Button size="lg" variant="primary" full disabled={n <= 0} onClick={() => onLog(n)} data-testid="amount-log">
        Log
      </Button>
    </div>
  );
}

function GramsPanel({ choice, start, onLog }: { choice: FoodChoice; start: number; onLog: (grams: number) => void }) {
  const [grams, setGrams] = useState<number | null>(start);
  const g = grams ?? 0;
  return (
    <div className="grid gap-3" data-testid="grams-panel">
      <div>
        <div className="mb-1 px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Weight (g)</div>
        <NumberInput value={grams} onChange={setGrams} mode="numeric" min={0} placeholder="100" testId="amount-grams-field" />
      </div>
      <Preview choice={choice} grams={g} />
      <Button size="lg" variant="primary" full disabled={g <= 0} onClick={() => onLog(g)} data-testid="amount-log">
        Log
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// A barcode the database could not fill

const MISS_LINE: Record<MissReason, string> = {
  notfound: 'Not in the database.',
  nofigures: 'In the database, but with no figures.',
  offline: 'No connection.',
  unavailable: 'Lookup unavailable.',
  invalid: 'Not a product barcode.',
};

function MissedStep({
  miss,
  onBack,
  onType,
  onScanAgain,
  onSnap,
}: {
  miss: Extract<Step, { kind: 'missed' }>;
  onBack: () => void;
  onType: () => void;
  onScanAgain: () => void;
  onSnap?: () => void;
}): ReactNode {
  return (
    <div className="grid gap-4" data-testid="missed-step">
      <div className="flex items-start gap-2">
        <IconButton label="Back to search" onClick={onBack} data-testid="amount-back" className="-ml-2">
          <BackIcon />
        </IconButton>
        <div className="min-w-0 flex-1 pt-1.5">
          {miss.partial && <div className="text-lg font-bold leading-tight">{[miss.partial.brand, miss.partial.name].filter(Boolean).join(' ')}</div>}
          <div className={miss.partial ? 'mt-1 text-sm text-muted' : 'text-base'} data-testid="barcode-line">
            {MISS_LINE[miss.reason]}
          </div>
        </div>
      </div>
      <div className="grid gap-2">
        <Button size="lg" variant="primary" full onClick={onType} data-testid="type-label">
          Type the label
        </Button>
        {onSnap && (
          <Button size="lg" variant="secondary" full onClick={onSnap} data-testid="snap-label">
            Snap the label
          </Button>
        )}
        <Button size="md" variant="ghost" full onClick={onScanAgain} data-testid="scan-again">
          Scan again
        </Button>
      </div>
    </div>
  );
}
