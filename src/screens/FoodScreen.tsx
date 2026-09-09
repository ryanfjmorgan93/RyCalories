import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { addDays } from '@/domain/dates';
import { fmtDayKey, fmtKcal, fmtTime } from '@/domain/format';
import { dayView } from '@/db/todayQueries';
import { deleteMeal, repeatMeal, type MealWithItems } from '@/db/foodRepo';
import { Button, IconButton } from '@/ui/components/Button';
import { Card, Divider, EmptyState, Row } from '@/ui/components/Card';
import { MacroLine, MacroSplit, TargetBar } from '@/ui/components/MacroBar';
import { Confirm, Sheet } from '@/ui/components/Sheet';
import { toast } from '@/ui/components/Toast';
import { BackIcon, ChevronIcon, MoreIcon, PlusIcon, TopBar } from '@/ui/components/TopBar';
import { useDayMeals, useSettings, useToday } from '@/ui/hooks';

/**
 * The day's food. Deliberately the whole feature on one screen: what the target is, what has
 * been eaten, and every meal, each one tap from being edited.
 */
export function FoodScreen() {
  const nav = useNavigate();
  const today = useToday();
  const [date, setDate] = useState(today);
  const settings = useSettings();
  const meals = useDayMeals(date);
  const [menuFor, setMenuFor] = useState<MealWithItems | null>(null);
  const [deleteFor, setDeleteFor] = useState<MealWithItems | null>(null);

  // Roll the view onto the new day if the app is left open past midnight, but only while
  // looking at today — never yank the screen away from a day being edited.
  useEffect(() => {
    setDate((d) => (d === today ? today : d));
  }, [today]);

  const view = useLiveQuery(async () => (settings ? dayView(date, settings, today) : undefined), [date, settings, today]);
  const yesterday = addDays(today, -1);
  const isToday = date === today;

  return (
    <div>
      <TopBar
        title="Food"
        subtitle={view?.legDay ? (view.legDayBasis === 'planned' ? 'Leg day (planned)' : 'Leg day') : undefined}
        right={
          <IconButton label="Add meal" onClick={() => nav(`/food/new?date=${date}`)} data-testid="add-meal">
            <PlusIcon />
          </IconButton>
        }
      />

      <div className="px-4">
        {/* Day navigation. Forward is capped at today: there is no logging food you have not eaten. */}
        <div className="flex items-center gap-1">
          <IconButton label="Previous day" onClick={() => setDate(addDays(date, -1))} data-testid="prev-day">
            <BackIcon />
          </IconButton>
          <button
            type="button"
            onClick={() => setDate(today)}
            disabled={isToday}
            className="min-w-0 flex-1 truncate py-2 text-center text-base font-bold disabled:opacity-100"
            data-testid="day-label"
          >
            {fmtDayKey(date, today, yesterday)}
          </button>
          <IconButton label="Next day" disabled={isToday} onClick={() => setDate(addDays(date, 1))} data-testid="next-day">
            <ChevronIcon className="text-current" />
          </IconButton>
        </div>

        <Card className="p-4">
          <TargetBar label="Calories" value={view?.eaten.kcal ?? 0} target={view?.calories?.kcal ?? null} unit="kcal" testId="calories-bar" />
          <div className="h-4" />
          <TargetBar label="Protein" value={view?.eaten.protein ?? 0} target={view?.proteinTarget ?? null} unit="g" tone="ok" testId="protein-bar" />
          <div className="h-4" />
          <MacroSplit m={view?.eaten ?? { kcal: 0, protein: 0, carbs: 0, fat: 0 }} />
          <div className="mt-2 flex items-center justify-between text-xs text-muted">
            <MacroLine m={view?.eaten ?? { kcal: 0, protein: 0, carbs: 0, fat: 0 }} />
            {view?.calories && (
              <span className="num tabular-nums" data-testid="remaining">
                {fmtKcal(Math.max(0, view.calories.kcal - view.eaten.kcal))} left
              </span>
            )}
          </div>
        </Card>

        <div className="h-4" />

        {meals === undefined && <div className="py-8 text-center text-sm text-muted">Loading…</div>}
        {meals && meals.length === 0 && <EmptyState>Nothing logged{isToday ? ' today' : ''}.</EmptyState>}
        {meals && meals.length > 0 && (
          <Card>
            {meals.map((m, i) => (
              <div key={m.meal.id}>
                {i > 0 && <Divider />}
                <Row
                  onClick={() => nav(`/food/${m.meal.id}`)}
                  title={m.meal.name}
                  subtitle={
                    <span>
                      {[m.meal.slot, fmtTime(m.meal.loggedAt)].filter(Boolean).join(' · ')} ·{' '}
                      {m.items.length} {m.items.length === 1 ? 'item' : 'items'}
                    </span>
                  }
                  right={
                    <div className="flex items-center gap-1">
                      <div className="text-right">
                        <div className="num font-extrabold tabular-nums">{fmtKcal(m.macros.kcal)}</div>
                        <MacroLine m={m.macros} className="text-[11px] text-muted" />
                      </div>
                      <IconButton label={`More for ${m.meal.name}`} onClick={() => setMenuFor(m)} data-testid={`meal-more-${m.meal.name}`}>
                        <MoreIcon />
                      </IconButton>
                    </div>
                  }
                />
              </div>
            ))}
          </Card>
        )}

        <div className="h-4" />
        <Button size="lg" variant="primary" full onClick={() => nav(`/food/new?date=${date}`)} data-testid="add-meal-button">
          Add meal
        </Button>
        <div className="h-8" />
      </div>

      <Sheet open={menuFor !== null} onClose={() => setMenuFor(null)} title={menuFor?.meal.name}>
        <div className="grid gap-3">
          <Button
            size="lg"
            full
            onClick={async () => {
              if (!menuFor) return;
              const id = await repeatMeal(menuFor.meal.id, today);
              setMenuFor(null);
              if (id) {
                toast('Copied to today');
                nav(`/food/${id}`);
              }
            }}
          >
            Copy to today
          </Button>
          <Button
            size="lg"
            full
            variant="danger"
            onClick={() => {
              setDeleteFor(menuFor);
              setMenuFor(null);
            }}
          >
            Delete
          </Button>
        </div>
      </Sheet>

      <Confirm
        open={deleteFor !== null}
        title={`Delete ${deleteFor?.meal.name ?? 'meal'}?`}
        confirmLabel="Delete"
        danger
        onCancel={() => setDeleteFor(null)}
        onConfirm={async () => {
          if (!deleteFor) return;
          await deleteMeal(deleteFor.meal.id);
          setDeleteFor(null);
          toast('Meal deleted');
        }}
      />
    </div>
  );
}
