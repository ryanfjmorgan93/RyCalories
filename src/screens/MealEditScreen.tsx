import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { addItem, addMeal, deleteItem, deleteMeal, updateItem, updateMeal, sumItems, type NewMealItem } from '@/db/foodRepo';
import { toDateKey } from '@/domain/dates';
import { displayMacros, type Macros } from '@/domain/food';
import { fmtDayKey, fmtGrams, fmtKcal } from '@/domain/format';
import { MEAL_SLOTS, type MealItem, type MealSlot } from '@/domain/types';
import { Button, IconButton } from '@/ui/components/Button';
import { Card, Divider, EmptyState, Row } from '@/ui/components/Card';
import { Chip } from '@/ui/components/Chip';
import { MacroLine } from '@/ui/components/MacroBar';
import { TextInput } from '@/ui/components/NumberField';
import { Confirm } from '@/ui/components/Sheet';
import { toast } from '@/ui/components/Toast';
import { PlusIcon, TopBar, TrashIcon } from '@/ui/components/TopBar';
import { FoodItemSheet } from '@/ui/FoodItemSheet';
import { useMeal, useToday } from '@/ui/hooks';

export function MealEditScreen() {
  const { id } = useParams();
  return id ? <ExistingMeal id={id} /> : <NewMeal />;
}

/**
 * A meal being composed. Everything lives in local state until Save, so a half-typed meal is
 * never written and every number stays editable before it is committed.
 */
function NewMeal() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const today = useToday();
  const date = params.get('date') ?? toDateKey();

  const [name, setName] = useState('');
  const [slot, setSlot] = useState<MealSlot | undefined>(defaultSlot());
  const [items, setItems] = useState<NewMealItem[]>([]);
  const [editing, setEditing] = useState<number | 'new' | null>(null);

  const macros = items.reduce<Macros>(
    (acc, i) => {
      const m = displayMacros(i.nutrition);
      return { kcal: acc.kcal + m.kcal, protein: acc.protein + m.protein, carbs: acc.carbs + m.carbs, fat: acc.fat + m.fat };
    },
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  );

  // Latched before the await. addMeal mints a fresh id every call, so a second tap landing
  // before the two-table write commits writes the whole meal again — two identical rows on the
  // day, both counted. Every other write-then-navigate action in this app is guarded the same way.
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const mealId = await addMeal({ name: name.trim() || fallbackName(slot), date, slot }, items);
      toast('Meal logged');
      nav(`/food/${mealId}`, { replace: true });
    } catch {
      setSaving(false);
      toast('Could not save the meal', 'danger');
    }
  };

  return (
    <div>
      <TopBar
        title="New meal"
        subtitle={fmtDayKey(date, today, '')}
        back="/food"
        right={
          <IconButton label="Add food" onClick={() => setEditing('new')} data-testid="add-food">
            <PlusIcon />
          </IconButton>
        }
      />
      <div className="px-4">
        <MealFields name={name} slot={slot} onName={setName} onSlot={setSlot} />
        <div className="h-4" />
        <ItemList
          items={items}
          onEdit={(i) => setEditing(i)}
          onAdd={() => setEditing('new')}
          macros={macros}
        />
        <div className="h-4" />
        <Button size="lg" variant="primary" full disabled={items.length === 0 || saving} onClick={() => void save()} data-testid="save-meal">
          Save meal
        </Button>
        <div className="h-8" />
      </div>

      <FoodItemSheet
        key={`new-${editing}`}
        open={editing !== null}
        item={typeof editing === 'number' ? items[editing] : undefined}
        onClose={() => setEditing(null)}
        onDelete={
          typeof editing === 'number'
            ? () => {
                setItems((prev) => prev.filter((_, i) => i !== editing));
                setEditing(null);
              }
            : undefined
        }
        onSave={(item) => {
          setItems((prev) => (typeof editing === 'number' ? prev.map((p, i) => (i === editing ? item : p)) : [...prev, item]));
          setEditing(null);
        }}
      />
    </div>
  );
}

/** A saved meal. Edits land immediately — there is nothing to confirm and nothing to lose. */
function ExistingMeal({ id }: { id: string }) {
  const nav = useNavigate();
  const today = useToday();
  const meal = useMeal(id);
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (meal === undefined) {
    return (
      <div>
        <TopBar title="Meal" back="/food" />
        <div className="py-10 text-center text-sm text-muted">Loading…</div>
      </div>
    );
  }
  if (meal === null) {
    return (
      <div>
        <TopBar title="Meal" back="/food" />
        <div className="px-4">
          <EmptyState>This meal no longer exists.</EmptyState>
        </div>
      </div>
    );
  }

  const items: NewMealItem[] = meal.items.map((i) => ({
    name: i.name,
    portion: i.portion,
    nutrition: i.nutrition,
    source: i.source,
    brand: i.brand,
    product: i.product,
  }));

  return (
    <div>
      <TopBar
        title={meal.meal.name}
        subtitle={fmtDayKey(meal.meal.date, today, '')}
        back="/food"
        right={
          <IconButton label="Delete meal" onClick={() => setConfirmDelete(true)} data-testid="delete-meal">
            <TrashIcon />
          </IconButton>
        }
      />
      <div className="px-4">
        <MealFields
          name={meal.meal.name}
          slot={meal.meal.slot}
          onName={(v) => void updateMeal(id, { name: v.trim() || 'Meal' })}
          onSlot={(v) => void updateMeal(id, { slot: v })}
        />
        <div className="h-4" />
        <ItemList items={items} onEdit={(i) => setEditing(i)} onAdd={() => setEditing('new')} macros={sumItems(meal.items)} />
        <div className="h-4" />
        <Button size="lg" variant="secondary" full onClick={() => setEditing('new')} data-testid="add-food-button">
          Add food
        </Button>
        <div className="h-8" />
      </div>

      <FoodItemSheet
        key={`edit-${editing}`}
        open={editing !== null}
        item={typeof editing === 'number' ? items[editing] : undefined}
        onClose={() => setEditing(null)}
        onDelete={
          typeof editing === 'number'
            ? async () => {
                const row = meal.items[editing];
                setEditing(null);
                if (row) await deleteItem(row.id);
              }
            : undefined
        }
        onSave={async (item) => {
          const index = editing;
          setEditing(null);
          if (typeof index === 'number') {
            const row = meal.items[index];
            // Brand and product go in the same patch as everything else. Omitted, a typed brand
            // was silently dropped, and applying Trek's label to a row that still said brand
            // "Aldi" left the wrong identity on the row for ever — Dexie's update merges, so
            // nothing ever cleared it — and keyed the food memory off the stale pair.
            if (row) await updateItem(row.id, itemPatch(item));
          } else {
            await addItem(id, item);
          }
        }}
      />

      <Confirm
        open={confirmDelete}
        title={`Delete ${meal.meal.name}?`}
        confirmLabel="Delete"
        danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          setConfirmDelete(false);
          await deleteMeal(id);
          toast('Meal deleted');
          nav('/food', { replace: true });
        }}
      />
    </div>
  );
}

function MealFields({
  name,
  slot,
  onName,
  onSlot,
}: {
  name: string;
  slot?: MealSlot;
  onName: (v: string) => void;
  onSlot: (v: MealSlot) => void;
}) {
  // Uncontrolled-ish: keep local text so typing is not fighting a live database round trip.
  const [text, setText] = useState(name);
  return (
    <div className="grid gap-3">
      <TextInput
        value={text}
        onChange={(v) => {
          setText(v);
          onName(v);
        }}
        placeholder="Meal name"
        testId="meal-name"
      />
      <div className="flex gap-2 overflow-x-auto pb-1">
        {MEAL_SLOTS.map((s) => (
          <Chip key={s} active={slot === s} onClick={() => onSlot(s)}>
            {s[0]!.toUpperCase() + s.slice(1)}
          </Chip>
        ))}
      </div>
    </div>
  );
}

function ItemList({
  items,
  macros,
  onEdit,
  onAdd,
}: {
  items: NewMealItem[];
  macros: Macros;
  onEdit: (index: number) => void;
  onAdd: () => void;
}) {
  if (!items.length) {
    return (
      <button type="button" onClick={onAdd} className="w-full" data-testid="empty-add-food">
        <EmptyState>No food yet. Tap to add.</EmptyState>
      </button>
    );
  }
  return (
    <Card>
      {items.map((item, i) => {
        // Display precision, matching the Total row below, so the column adds up.
        const m = displayMacros(item.nutrition);
        const grams = item.nutrition.basis === 'weighed' ? item.nutrition.grams : null;
        return (
          <div key={`${item.name}-${i}`}>
            {i > 0 && <Divider />}
            <Row
              onClick={() => onEdit(i)}
              title={item.name}
              subtitle={grams !== null ? fmtGrams(grams) : item.portion}
              right={
                <div className="text-right">
                  <div className="num font-extrabold tabular-nums">{fmtKcal(m.kcal)}</div>
                  <MacroLine m={m} className="text-[11px] text-muted" />
                </div>
              }
            />
          </div>
        );
      })}
      <Divider />
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Total</span>
        <div className="text-right">
          <div className="num font-extrabold tabular-nums" data-testid="meal-total">
            {fmtKcal(macros.kcal)}
          </div>
          <MacroLine m={macros} className="text-[11px] text-muted" />
        </div>
      </div>
    </Card>
  );
}

/** Best guess at the slot from the clock. A guess, and one tap to change. */
function defaultSlot(): MealSlot {
  const h = new Date().getHours();
  if (h < 11) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h < 21) return 'dinner';
  return 'snack';
}

function fallbackName(slot?: MealSlot): string {
  return slot ? slot[0]!.toUpperCase() + slot.slice(1) : 'Meal';
}

/**
 * The full set of fields an edit writes, so an edited row matches what adding the same food would
 * have written. `undefined` clears a field the draft no longer has, which is why brand and product
 * are always present rather than spread in conditionally.
 */
function itemPatch(item: NewMealItem): Partial<Omit<MealItem, 'id' | 'mealId' | 'index'>> {
  return {
    name: item.name,
    portion: item.portion,
    nutrition: item.nutrition,
    source: item.source ?? 'user',
    brand: item.brand,
    product: item.product,
  };
}
