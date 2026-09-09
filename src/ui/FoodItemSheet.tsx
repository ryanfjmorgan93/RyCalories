import { useEffect, useState, type ReactNode } from 'react';
import {
  checkAtwater,
  fromPer100,
  fromPortion,
  macrosOf,
  type Macros,
  type Nutrition,
} from '@/domain/food';
import { fmtGrams, fmtKcal } from '@/domain/format';
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
  const [d, setD] = useState<Draft>(() => draftFrom(item));

  // Reset when the sheet is opened on a different food.
  useEffect(() => {
    if (open) setD(draftFrom(item));
  }, [open, item]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));
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
                source: 'user',
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
