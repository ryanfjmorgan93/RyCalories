import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { deleteMeal, logUsual, usualsOn } from '@/db/foodRepo';
import { ZERO, addMacros, displayMacros } from '@/domain/food';
import { fmtKcal, fmtNum } from '@/domain/format';
import type { MealSlot } from '@/domain/types';
import type { OfferedUsual } from '@/domain/usualMeals';
import { noteMealLogged } from '@/state/mealMoment';
import { SectionTitle } from './components/Card';
import { toast } from './components/Toast';

function capitalise(s: string): string {
  return s[0]!.toUpperCase() + s.slice(1);
}

const SLOT_PLURAL: Record<MealSlot, string> = { breakfast: 'breakfasts', lunch: 'lunches', dinner: 'dinners', snack: 'snacks' };

/**
 * The usual meals for a slot (domain/usualMeals.ts): the ones saved, then the ones the owner's own
 * history shows. One tap logs one, with an Undo; nothing already on the day is offered. On the Food
 * day the slot is the clock's; in Add food it is the one chosen, and `onLogged` closes the sheet.
 */
export function UsualMeals({ date, slot, onLogged }: { date: string; slot: MealSlot; onLogged?: () => void }) {
  const offered = useLiveQuery(() => usualsOn(date, slot), [date, slot]);
  const [busy, setBusy] = useState(false);
  if (!offered || offered.length === 0) return null;
  const log = async (usual: OfferedUsual) => {
    // Latched: logUsual makes a new meal on every call, so a second tap would log it twice.
    if (busy) return;
    setBusy(true);
    try {
      const id = await logUsual(date, slot, usual);
      noteMealLogged({ mealId: id });
      toast(`Logged to ${capitalise(slot)}`, 'ok', { label: 'Undo', onClick: () => void deleteMeal(id) });
      onLogged?.();
    } finally {
      setBusy(false);
    }
  };
  return (
    <section data-testid="usual-meals">
      <SectionTitle right={<span className="pb-px text-xs text-muted">one tap logs it</span>}>Your usual {SLOT_PLURAL[slot]}</SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        {offered.map((usual) => {
          const m = usual.items.reduce((acc, i) => addMacros(acc, displayMacros(i.nutrition)), ZERO);
          // A meal that only carries its slot's name says more by its foods.
          const title = usual.name.toLowerCase() === slot ? usual.items.map((i) => i.name).join(', ') : usual.name;
          return (
            <button
              key={usual.key}
              type="button"
              disabled={busy}
              onClick={() => void log(usual)}
              className="flex min-h-14 items-center gap-2 rounded-[14px] border border-accent/45 bg-surface px-3 py-2.5 text-left active:bg-accent/10 disabled:opacity-60"
              data-testid="usual-meal"
            >
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 block text-sm font-medium leading-tight">{title}</span>
                <span className="num mt-0.5 block text-xs text-muted">
                  {fmtKcal(m.kcal)} · P {fmtNum(Math.round(m.protein))}
                </span>
              </span>
              <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-fg text-lg font-medium leading-none text-bg">
                +
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
