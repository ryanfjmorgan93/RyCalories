import { useState, type ReactNode } from 'react';
import {
  checkAtwater,
  fromPer100,
  fromPortion,
  macrosOf,
  type FoodSource,
  type Macros,
  type Nutrition,
} from '@/domain/food';
import { fmtGrams, fmtKcal } from '@/domain/format';
import { useFoodSuggestions } from './hooks';
import { normalise } from '@/domain/foodMemory';
import type { FoodMemory } from '@/domain/types';
import type { NewMealItem } from '@/db/foodRepo';
import { Button } from './components/Button';
import { Segmented } from './components/Chip';
import { NumberInput, TextInput } from './components/NumberField';
import { Sheet } from './components/Sheet';

type Basis = 'weighed' | 'portion';

interface Draft {
  name: string;
  portion: string;
  basis: Basis;
  brand?: string;
  product?: string;
  /** Where these numbers came from. Carried through so the trust hierarchy still applies. */
  source?: FoodSource;
  grams: number | null;
  /** Per 100 g when weighed; for the whole serving when not. */
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
}

function draftFrom(item?: NewMealItem): Draft {
  if (!item) {
    return { name: '', portion: '', basis: 'weighed', grams: 100, kcal: null, protein: null, carbs: null, fat: null };
  }
  const n = item.nutrition;
  const m = n.basis === 'weighed' ? n.per100 : n.macros;
  return {
    name: item.name,
    portion: item.portion,
    basis: n.basis,
    ...(item.brand ? { brand: item.brand } : {}),
    ...(item.product ? { product: item.product } : {}),
    ...(item.source ? { source: item.source } : {}),
    grams: n.basis === 'weighed' ? n.grams : null,
    kcal: m.kcal,
    protein: m.protein,
    carbs: m.carbs,
    fat: m.fat,
  };
}

function macrosFrom(d: Draft): Macros {
  return { kcal: d.kcal ?? 0, protein: d.protein ?? 0, carbs: d.carbs ?? 0, fat: d.fat ?? 0 };
}

function nutritionFrom(d: Draft): Nutrition {
  return d.basis === 'weighed' ? fromPer100(macrosFrom(d), d.grams ?? 0) : fromPortion(macrosFrom(d));
}

/**
 * Add or edit one food. Numbers are entered in whichever form the packet or the kitchen scale
 * gives them — per 100 g against a weight, or for the whole serving — and the eaten total is
 * shown live underneath, so the figure being committed is never a surprise.
 */
export function FoodItemSheet({
  open,
  item,
  onClose,
  onSave,
  onDelete,
}: {
  open: boolean;
  /** Absent for a new food. */
  item?: NewMealItem;
  onClose: () => void;
  onSave: (item: NewMealItem) => void;
  onDelete?: () => void;
}) {
  // Seeded once. There is deliberately no reset effect: the parent rebuilds its item objects on
  // every render, so an effect keyed on the `item` prop fires whenever anything else re-renders
  // the screen and throws away half-entered input — and a focused number field goes on showing
  // the number the user typed while the draft behind it has reverted, so Save writes a different
  // value than the one on screen. The sheet is instead remounted per edit target with a `key`.
  const [d, setD] = useState<Draft>(() => draftFrom(item));

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));

  // Suggestions only while adding a new food. When editing a saved one the numbers on screen are
  // the ones being corrected, and offering to overwrite them with a remembered version is the
  // opposite of what the user came here to do.
  const all = useFoodSuggestions(item ? null : d.name, 6) ?? [];
  // Drop the entry whose name the draft already carries: after picking it, it is applied, and a
  // row offering to apply it again is noise. This also means retyping brings the list back,
  // without a flag to get out of step with what is on screen.
  const suggestions = all.filter((m) => normalise(m.name) !== normalise(d.name)).slice(0, 5);

  const usePrevious = (m: FoodMemory) => {
    setD({
      name: m.name,
      portion: '',
      basis: 'weighed',
      grams: m.typicalGrams ?? 100,
      kcal: m.per100.kcal,
      protein: m.per100.protein,
      carbs: m.per100.carbs,
      fat: m.per100.fat,
      brand: m.brand,
      product: m.product,
      // Carried across, so a remembered label keeps its standing and a remembered guess does not
      // acquire one it never had.
      source: m.source,
    });
  };
  const eaten = macrosOf(nutritionFrom(d));
  const check = checkAtwater(macrosFrom(d));
  const canSave = d.name.trim().length > 0;
  const per = d.basis === 'weighed' ? 'per 100 g' : 'for the serving';

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={item ? 'Edit food' : 'Add food'}
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
            onClick={() =>
              onSave({
                name: d.name.trim(),
                portion: d.portion.trim() || (d.basis === 'weighed' ? `${d.grams ?? 0} g` : '1 serving'),
                nutrition: nutritionFrom(d),
                source: d.source ?? 'user',
                ...(d.brand ? { brand: d.brand } : {}),
                ...(d.product ? { product: d.product } : {}),
              })
            }
          >
            Save
          </Button>
        </div>
      }
    >
      <div className="grid gap-4">
        <Field label="Food">
          <TextInput value={d.name} onChange={(v) => set('name', v)} placeholder="Chicken thigh" testId="food-name" autoFocus={!item} />
        </Field>

        {suggestions.length > 0 && (
          <div className="-mt-2 overflow-hidden rounded-xl border border-line" data-testid="food-suggestions">
            {suggestions.map((m, i) => (
              <button
                key={m.id}
                type="button"
                onClick={() => usePrevious(m)}
                data-testid={`suggest-${m.name}`}
                className={`flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left active:bg-surface-2 ${i > 0 ? 'border-t border-line' : ''}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold leading-tight">{[m.brand, m.name].filter(Boolean).join(' ')}</div>
                  <div className="num mt-0.5 truncate text-xs text-muted">
                    {fmtKcal(m.per100.kcal)} / 100 g{m.typicalGrams ? ` · usually ${fmtGrams(m.typicalGrams)}` : ''}
                  </div>
                </div>
              </button>
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
          <Field label="Weight">
            <NumberInput value={d.grams} onChange={(v) => set('grams', v)} mode="numeric" min={0} placeholder="100" testId="food-grams" />
          </Field>
        ) : (
          <Field label="Portion">
            <TextInput value={d.portion} onChange={(v) => set('portion', v)} placeholder="1 bowl" testId="food-portion" />
          </Field>
        )}

        <div>
          <div className="mb-2 px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Nutrition {per}</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Calories">
              <NumberInput value={d.kcal} onChange={(v) => set('kcal', v)} mode="numeric" min={0} placeholder="0" testId="food-kcal" />
            </Field>
            <Field label="Protein (g)">
              <NumberInput value={d.protein} onChange={(v) => set('protein', v)} min={0} placeholder="0" testId="food-protein" />
            </Field>
            <Field label="Carbs (g)">
              <NumberInput value={d.carbs} onChange={(v) => set('carbs', v)} min={0} placeholder="0" testId="food-carbs" />
            </Field>
            <Field label="Fat (g)">
              <NumberInput value={d.fat} onChange={(v) => set('fat', v)} min={0} placeholder="0" testId="food-fat" />
            </Field>
          </div>
        </div>

        {/* The macros contradicting the calorie figure is worth one line, and only one. */}
        {!check.ok && (
          <button
            type="button"
            onClick={() => set('kcal', Math.round(check.implied))}
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
