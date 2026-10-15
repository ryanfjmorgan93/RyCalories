import { useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { checkAtwater, macrosOf } from '@/domain/food';
import { fmtGrams, fmtKcal } from '@/domain/format';
import { useFoodSuggestions, useSettings } from './hooks';
import { lookupBarcode, lookupName } from '@/db/productRepo';
import { forgetFood, memoryFor } from '@/db/foodRepo';
import { barcodeDigits, displayName, type LabelNutrition } from '@/domain/products';
import { normalise } from '@/domain/foodMemory';
import {
  applyLabel as labelOnto,
  applyMemory,
  blankDraft,
  draftFrom,
  draftToItem,
  editAmount,
  editNutrition,
  macrosFrom,
  nutritionFrom,
  type Basis,
  type Draft,
  type NutritionField,
} from '@/domain/foodDraft';
import { amountChips, defaultUnit, unitOptions, type UnitOption } from '@/domain/foodUnits';
import type { FoodMemory } from '@/domain/types';
import type { NewMealItem } from '@/db/foodRepo';
import { BarcodeScanner } from './BarcodeScanner';
import { Button, IconButton } from './components/Button';
import { Chip, Segmented } from './components/Chip';
import { NumberInput, TextInput } from './components/NumberField';
import { Sheet } from './components/Sheet';
import { TrashIcon } from './components/TopBar';

/**
 * Add or edit one food. Numbers are entered in whichever form the packet or the kitchen scale
 * gives them — per 100 g against a weight, or for the whole serving — and the eaten total is
 * shown live underneath, so the figure being committed is never a surprise.
 *
 * The amount can be tapped in the food's own units (a whole pack, half, two eggs) as well as typed
 * in grams. Changing the amount never changes whose figures these are: only editing the nutrition
 * does (see `domain/foodDraft.ts`).
 */
export function FoodItemSheet({
  open,
  item,
  onClose,
  onSave,
  onDelete,
  title,
  prefill,
}: {
  open: boolean;
  /** Absent for a new food. */
  item?: NewMealItem;
  onClose: () => void;
  onSave: (item: NewMealItem) => void;
  onDelete?: () => void;
  /** Overrides "Add food" / "Edit food". */
  title?: string;
  /**
   * A new food that starts from something already known: the name (and brand) a barcode lookup
   * found without figures, and the barcode to remember the food against once it is typed in. Only
   * read when mounted, like `item`.
   */
  prefill?: { name?: string; brand?: string; product?: string; barcode?: string };
}) {
  // Seeded once. There is deliberately no reset effect: the parent rebuilds its item objects on
  // every render, so an effect keyed on the `item` prop fires whenever anything else re-renders
  // the screen and throws away half-entered input — and a focused number field goes on showing
  // the number the user typed while the draft behind it has reverted, so Save writes a different
  // value than the one on screen. The sheet is instead remounted per edit target with a `key`.
  const [d, setD] = useState<Draft>(() => {
    const base = draftFrom(item);
    if (!prefill || item) return base;
    return {
      ...base,
      ...(prefill.name ? { name: prefill.name } : {}),
      ...(prefill.brand ? { brand: prefill.brand } : {}),
      ...(prefill.product ? { product: prefill.product } : {}),
    };
  });
  // 'searching' is a name lookup and 'scanning' a barcode one: each says "Looking up…" on its own
  // button. Scanning used to share 'searching', whose only visible sign was on the name-lookup
  // button — hidden until three letters are typed and again once a label is applied, which is
  // exactly the state a second scan starts from — so a scan in flight showed nothing at all.
  const [lookup, setLookup] = useState<
    'idle' | 'searching' | 'scanning' | 'none' | 'offline' | 'unavailable' | 'notfound' | 'nofigures' | 'invalid'
  >('idle');
  const busy = lookup === 'searching' || lookup === 'scanning';
  const [scannerOpen, setScannerOpen] = useState(false);
  // The barcode of the last scan the database could not fill. Kept until Save, or until a later
  // scan replaces it, and handed to the save so the food is remembered against that pack: the next
  // scan of it then fills from memory. Never set for a code that was not a barcode, and never
  // for a scan that filled the sheet — that pack is the database's, not the user's to type in.
  const [scannedCode, setScannedCode] = useState<string | undefined>(() => (prefill?.barcode ? (barcodeDigits(prefill.barcode) ?? undefined) : undefined));
  // The reasons Save can be grey, said where the eye is (see `needsName`): the user has done
  // something to the sheet by hand, so an empty name is no longer just a sheet that has not been used.
  const [typedFigure, setTypedFigure] = useState(false);
  const [nameEdited, setNameEdited] = useState(false);
  // Bumped by anything that changes what a lookup would be for. A response whose ticket is stale
  // is discarded rather than applied to a food nobody asked about.
  const requestRef = useRef(0);
  // Off means off: no request is made at all, not merely hidden.
  const lookupEnabled = useSettings()?.productLookup !== false;

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));

  /**
   * Change the amount: the weight, or a unit chip. The food is unchanged, so its source is too.
   *
   * It used to go through the same setter as the nutrition fields, which flipped `source` to
   * 'user' on ANY edit — so a scanned label eaten at 250 g instead of 100 g was saved as the
   * user's own data, and the trust hierarchy, working as designed, then refused every later and
   * better label for it.
   */
  const setAmount = (grams: number | null, unitKey: string) => setD((p) => editAmount(p, { grams, unitKey }));

  /**
   * Set a figure the user has typed, and record that they typed it.
   *
   * Without this the draft kept whatever source the lookup or the suggestion put there, so a
   * hand-corrected number was saved badged 'label' — and the trust hierarchy, working exactly as
   * designed, then let the next label lookup overwrite the correction with the figures the user
   * had gone back and fixed.
   */
  const setNutrition = (k: NutritionField, v: number | null) => {
    setTypedFigure(true);
    setD((p) => editNutrition(p, k, v));
  };

  /** Changing what is being searched for invalidates whatever the last search said about it. */
  const setSearchable = <K extends 'name' | 'brand'>(k: K, v: string) => {
    requestRef.current += 1;
    setLookup('idle');
    if (k === 'name') setNameEdited(true);
    setD((p) => ({ ...p, [k]: v, ...(k === 'name' ? { fromLabel: false } : {}) }));
  };

  // Suggestions only while adding a new food. When editing a saved one the numbers on screen are
  // the ones being corrected, and offering to overwrite them with a remembered version is the
  // opposite of what the user came here to do.
  const all = useFoodSuggestions(item ? null : d.name, 6) ?? [];
  // Drop the entry whose name the draft already carries: after picking it, it is applied, and a
  // row offering to apply it again is noise. This also means retyping brings the list back,
  // without a flag to get out of step with what is on screen.
  const suggestions = all.filter((m) => normalise(m.name) !== normalise(d.name)).slice(0, 5);

  // The units this food is counted in: the pack and serving a label stated, and whatever has been
  // remembered for it (a corrected egg weight, the unit last used). Looked up by the same key the
  // food is filed under, so it follows the name as it is typed.
  const memory = useLiveQuery(
    () => (d.name.trim() ? memoryFor({ name: d.name, brand: d.brand, product: d.product }) : undefined),
    [d.name, d.brand, d.product],
  );
  const unitSource = {
    ...(d.packGrams ? { packGrams: d.packGrams } : {}),
    ...(d.servingGrams ? { servingGrams: d.servingGrams } : {}),
    ...(memory ? { memory } : {}),
  };
  const options = unitOptions(unitSource);
  const countable = options.filter((o) => o.kind !== 'grams');
  const unit = options.find((o) => o.key === d.unitKey && o.kind !== 'grams') ?? defaultUnit(countable.length > 0 ? countable : options, unitSource);

  /**
   * Put a label's figures on the sheet.
   *
   * `fromScan`: a barcode names one product, so its identity replaces whatever was there. Falling
   * back to the previous brand meant scanning a brandless product after a Trek flapjack saved it
   * as Trek. A name lookup keeps the fallback: there the brand is the one the user typed.
   */
  const applyLabel = (l: LabelNutrition, opts?: { fromScan?: boolean }) => {
    setLookup('idle');
    setD((p) => labelOnto(p, l, opts));
  };

  const runLookup = async () => {
    if (busy) return;
    const asked = { text: d.name.trim(), brand: d.brand?.trim() ?? '' };
    // Which search this is. A lookup can take up to the repository's timeout, and nothing stops
    // the user editing meanwhile — so a slow answer for "Protein Flapjack" could land on a sheet
    // that now says "Chicken thigh" and overwrite every field of it, with no undo.
    const ticket = (requestRef.current += 1);
    setLookup('searching');
    // Never leave the button on "Looking up…": anything that escapes the repository still has to
    // land somewhere the user can act on.
    try {
      const result = await lookupName({ text: asked.text, ...(asked.brand ? { brand: asked.brand } : {}) });
      if (ticket !== requestRef.current) return;
      if (result.label) applyLabel(result.label);
      else if (result.from === 'offline') setLookup('offline');
      else if (result.from === 'network' || result.from === 'cache') setLookup('none');
      else setLookup('unavailable');
    } catch {
      if (ticket === requestRef.current) setLookup('unavailable');
    }
  };

  /**
   * A scan that found nothing. If the sheet is showing a label, that label belongs to some other
   * product — the one scanned or looked up before — and leaving it there under a "Not in the
   * database" line is how the previous food gets logged in place of this one. So it goes, and the
   * sheet starts again blank. Anything the user typed themselves is theirs and stays.
   */
  const scanMissed = (outcome: 'offline' | 'invalid' | 'notfound' | 'unavailable') => {
    setLookup(outcome);
    setD((p) => (p.fromLabel ? blankDraft() : p));
  };

  /**
   * A scan of a pack the database knows by name only. The name (and brand) go in when the sheet
   * has none of its own — a name the user typed is theirs and stays — and the figures are left to
   * be typed.
   */
  const scanPartial = (partial: { name: string; brand?: string }) => {
    setLookup('nofigures');
    setD((p) => {
      const base = p.fromLabel ? blankDraft() : p;
      if (base.name.trim()) return base;
      const brand = partial.brand ?? '';
      return {
        ...base,
        name: displayName({ brand, name: partial.name }),
        product: partial.name,
        ...(brand ? { brand } : {}),
      };
    });
  };

  /** A code from the camera or typed by hand. Scanning is a lookup, so it shares the same ticket. */
  const onScanCode = async (code: string) => {
    setScannerOpen(false);
    const ticket = (requestRef.current += 1);
    setLookup('scanning');
    // Only a barcode can be remembered against; a code of the wrong length is answered 'invalid'
    // below and leaves whatever was already being typed in for an earlier scan alone.
    const digits = barcodeDigits(code) ?? undefined;
    try {
      const result = await lookupBarcode(code);
      if (ticket !== requestRef.current) return;
      if (result.from === 'memory' && result.memory) {
        // Typed in against this pack before. It is the user's own entry, so it goes in as one
        // (see usePrevious) and there is nothing to remember a second time.
        setScannedCode(undefined);
        setLookup('idle');
        usePrevious(result.memory);
      } else if (result.label) {
        setScannedCode(undefined);
        applyLabel(result.label, { fromScan: true });
      } else if (result.from === 'invalid') {
        scanMissed('invalid');
      } else {
        // Nothing came back to fill the sheet, for whatever reason: whatever the user types next
        // is this pack.
        setScannedCode(digits);
        if (result.partial) scanPartial(result.partial);
        else if (result.from === 'offline') scanMissed('offline');
        else if (result.from === 'network' || result.from === 'cache') scanMissed('notfound');
        else scanMissed('unavailable');
      }
    } catch {
      if (ticket === requestRef.current) {
        setScannedCode(digits);
        scanMissed('unavailable');
      }
    }
  };

  const usePrevious = (m: FoodMemory) => {
    setD(applyMemory(m));
  };
  const eaten = macrosOf(nutritionFrom(d));
  const check = checkAtwater(macrosFrom(d));
  const canSave = d.name.trim().length > 0;
  // Save is grey for want of a name, and nothing else on the sheet says so. Shown once there is
  // something for it to be the reason for: a lookup has answered (or filled the figures without a
  // name), or the user has typed a figure or emptied the name themselves. A sheet nobody has touched
  // stays quiet, and one still waiting on an answer says nothing until it has one.
  const needsName =
    d.name.trim().length === 0 && !busy && (lookup !== 'idle' || typedFigure || nameEdited || d.source === 'label');
  // Looking up needs something to look up, and is pointless once a label has supplied the numbers.
  const canLookUp = lookupEnabled && d.name.trim().length >= 3 && d.source !== 'label';
  const per = d.basis === 'weighed' ? 'per 100 g' : 'for the serving';

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={title ?? (item ? 'Edit food' : 'Add food')}
        footer={
          <div className="grid grid-cols-2 gap-3">
            {onDelete ? (
              <Button size="lg" variant="danger" onClick={onDelete}>
                Delete
              </Button>
            ) : (
              <Button size="lg" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
            )}
            <Button
              size="lg"
              variant="primary"
              disabled={!canSave}
              data-testid="save-food"
              onClick={() => onSave(draftToItem(d, { options, ...(scannedCode ? { barcode: scannedCode } : {}) }))}
            >
              Save
            </Button>
          </div>
        }
      >
        <div className="grid gap-4">
          <Field label="Food">
            <TextInput value={d.name} onChange={(v) => setSearchable('name', v)} placeholder="Chicken thigh" testId="food-name" autoFocus={!item} />
            {needsName && (
              <div className="mt-1 px-1 text-xs text-muted" data-testid="food-needs-name">
                Needs a name
              </div>
            )}
          </Field>

          {lookupEnabled && (
            <div className="-mt-2 grid gap-2">
              <div className={canLookUp ? 'grid grid-cols-2 gap-2' : ''}>
                <Button
                  size="md"
                  variant="outline"
                  full
                  disabled={busy}
                  onClick={() => setScannerOpen(true)}
                  data-testid="scan-barcode"
                >
                  {lookup === 'scanning' ? 'Looking up…' : 'Scan barcode'}
                </Button>
                {canLookUp && (
                  <Button size="md" variant="outline" full disabled={busy} onClick={() => void runLookup()} data-testid="lookup-food">
                    {lookup === 'searching' ? 'Looking up…' : 'Look up the label'}
                  </Button>
                )}
              </div>
              {canLookUp && (
                <TextInput
                  value={d.brand ?? ''}
                  onChange={(v) => setSearchable('brand', v)}
                  placeholder="Brand (optional)"
                  testId="food-brand"
                />
              )}
              {lookup === 'none' && (
                <div className="px-1 text-xs text-muted" data-testid="lookup-none">
                  No matching product{d.brand?.trim() ? ` from ${d.brand.trim()}` : ''}.
                </div>
              )}
              {lookup === 'notfound' && (
                <div className="px-1 text-xs text-muted" data-testid="lookup-notfound">
                  Not in the database. Type the name and figures from the pack.
                </div>
              )}
              {lookup === 'nofigures' && (
                <div className="px-1 text-xs text-muted" data-testid="lookup-nofigures">
                  No figures in the database. Type them from the pack.
                </div>
              )}
              {lookup === 'offline' && (
                <div className="px-1 text-xs text-muted" data-testid="lookup-offline">
                  No connection. Type the figures from the pack.
                </div>
              )}
              {lookup === 'unavailable' && (
                <div className="px-1 text-xs text-muted" data-testid="lookup-unavailable">
                  Lookup unavailable. Try again, or type the figures from the pack.
                </div>
              )}
              {lookup === 'invalid' && (
                <div className="px-1 text-xs text-muted" data-testid="lookup-invalid">
                  Not a product barcode.
                </div>
              )}
            </div>
          )}

          {suggestions.length > 0 && (
            <div className="-mt-2 overflow-hidden rounded-xl border border-line" data-testid="food-suggestions">
              {suggestions.map((m, i) => (
                <div key={m.id} className={`flex items-center ${i > 0 ? 'border-t border-line' : ''}`}>
                  <button
                    type="button"
                    onClick={() => usePrevious(m)}
                    data-testid={`suggest-${m.name}`}
                    className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left active:bg-surface-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="break-words font-semibold leading-tight">{[m.brand, m.name].filter(Boolean).join(' ')}</div>
                      <div className="num mt-0.5 break-words text-xs text-muted">
                        {fmtKcal(m.per100.kcal)} / 100 g{m.typicalGrams ? ` · usually ${fmtGrams(m.typicalGrams)}` : ''}
                      </div>
                    </div>
                  </button>
                  {/* Nothing else removes a remembered food, so a name typed wrong once would be
                      offered here for ever. */}
                  <IconButton label={`Forget ${m.name}`} onClick={() => void forgetFood(m.id)} data-testid={`forget-${m.name}`}>
                    <TrashIcon />
                  </IconButton>
                </div>
              ))}
            </div>
          )}

          <Segmented<Basis>
            value={d.basis}
            onChange={(v) => set('basis', v)}
            options={[
              { value: 'weighed', label: 'Weighed' },
              { value: 'portion', label: 'Whole portion' },
            ]}
          />

          {d.basis === 'weighed' ? (
            <div className="grid gap-3">
              {countable.length > 0 && (
                <UnitChips
                  countable={countable}
                  unit={unit}
                  grams={d.grams}
                  onPick={(grams, key) => setAmount(grams, key)}
                  onUnit={(key) => set('unitKey', key)}
                />
              )}
              <Field label="Weight">
                <NumberInput value={d.grams} onChange={(v) => setAmount(v, 'g')} mode="numeric" min={0} placeholder="100" testId="food-grams" />
              </Field>
            </div>
          ) : (
            <Field label="Portion">
              <TextInput value={d.portion} onChange={(v) => set('portion', v)} placeholder="1 bowl" testId="food-portion" />
            </Field>
          )}

          <div>
            <div className="mb-2 px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Nutrition {per}</div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Calories">
                <NumberInput value={d.kcal} onChange={(v) => setNutrition('kcal', v)} mode="numeric" min={0} placeholder="0" testId="food-kcal" />
              </Field>
              <Field label="Protein (g)">
                <NumberInput value={d.protein} onChange={(v) => setNutrition('protein', v)} min={0} placeholder="0" testId="food-protein" />
              </Field>
              <Field label="Carbs (g)">
                <NumberInput value={d.carbs} onChange={(v) => setNutrition('carbs', v)} min={0} placeholder="0" testId="food-carbs" />
              </Field>
              <Field label="Fat (g)">
                <NumberInput value={d.fat} onChange={(v) => setNutrition('fat', v)} min={0} placeholder="0" testId="food-fat" />
              </Field>
            </div>
          </div>

          {/* The macros contradicting the calorie figure is worth one line, and only one. */}
          {!check.ok && (
            <button
              type="button"
              onClick={() => setNutrition('kcal', Math.round(check.implied))}
              className="rounded-xl border border-warn/40 bg-warn/10 px-3 py-3 text-left text-sm text-warn"
              data-testid="atwater-warning"
            >
              Macros come to {fmtKcal(check.implied)}. Tap to use that.
            </button>
          )}

          <div className="flex items-baseline justify-between rounded-xl bg-surface-2 px-3 py-3">
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Eaten</span>
            <span className="num font-extrabold tabular-nums" data-testid="food-eaten">
              {fmtKcal(eaten.kcal)}
              {d.basis === 'weighed' && d.grams ? <span className="text-muted"> · {fmtGrams(d.grams)}</span> : null}
            </span>
          </div>
        </div>
      </Sheet>
      <BarcodeScanner open={scannerOpen} onClose={() => setScannerOpen(false)} onCode={(code) => void onScanCode(code)} />
    </>
  );
}

/**
 * The amount in the food's own units: which unit (when it has more than one) and the chips for it.
 * Tapping a chip sets the weight; the weight field below stays the source of truth and can still
 * be typed over.
 */
function UnitChips({
  countable,
  unit,
  grams,
  onPick,
  onUnit,
}: {
  countable: UnitOption[];
  unit: UnitOption;
  grams: number | null;
  onPick: (grams: number, unitKey: string) => void;
  onUnit: (key: string) => void;
}) {
  return (
    <div className="grid gap-2" data-testid="unit-chips">
      {countable.length > 1 && (
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Count in">
          {countable.map((o) => (
            <Chip key={o.key} active={o.key === unit.key} onClick={() => onUnit(o.key)} testId={`unit-${o.key}`}>
              {o.label[0]!.toUpperCase() + o.label.slice(1)}
            </Chip>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {amountChips(unit).map((c) => (
          <Chip key={c.id} size="lg" active={grams !== null && Math.abs(grams - c.grams) < 0.05} onClick={() => onPick(c.grams, unit.key)} testId={`amount-${c.id}`}>
            {c.label}
          </Chip>
        ))}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">{label}</div>
      {children}
    </div>
  );
}
