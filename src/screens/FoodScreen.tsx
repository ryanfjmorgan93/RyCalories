import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { addDays, isoToDateKey } from '@/domain/dates';
import { fmtDayKey, fmtKcal, fmtTime } from '@/domain/format';
import { ZERO } from '@/domain/food';
import { dayView } from '@/db/todayQueries';
import { deleteMeal, repeatMeal, type MealWithItems } from '@/db/foodRepo';
import { Button, IconButton } from '@/ui/components/Button';
import { Card, Divider, EmptyState, Row } from '@/ui/components/Card';
import { MacroLine, MacroSplit, TargetBar } from '@/ui/components/MacroBar';
import { Confirm, Sheet } from '@/ui/components/Sheet';
import { toast } from '@/ui/components/Toast';
import { BackIcon, ChevronIcon, MoreIcon, PlusIcon, TopBar } from '@/ui/components/TopBar';
import { useDayMeals, useRecentMeals, useSettings, useToday } from '@/ui/hooks';

/**
 * The day's food. Deliberately the whole feature on one screen: what the target is, what has
 * been eaten, and every meal, each one tap from being edited.
 */
export function FoodScreen() {
  const nav = useNavigate();
  const today = useToday();
  const [date, setDate] = useState(today);
  const [menuFor, setMenuFor] = useState<MealWithItems | null>(null);
  const [deleteFor, setDeleteFor] = useState<MealWithItems | null>(null);
  const [copying, setCopying] = useState(false);
  const [repeatOpen, setRepeatOpen] = useState(false);

  // Roll the view onto the new day if the app is left open past midnight, but only while
  // looking at today — never yank the screen away from a day being edited.
  //
  // This needs the PREVIOUS value of `today` to know whether the user was looking at "today".
  // Comparing against the new value cannot work: by the time the effect runs, `today` is already
  // the new day, so `d === today` is false for the very screen that should move, and the whole
  // effect collapses into a no-op. Left that way, a meal added at 00:20 is written to yesterday.
  const prevToday = useRef(today);
  useEffect(() => {
    setDate((d) => (d === prevToday.current ? today : d));
    prevToday.current = today;
  }, [today]);

  const yesterday = addDays(today, -1);
  const isToday = date === today;

  return (
    <div>
      <TopBar
        title="Food"
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

        {/* Keyed by the day. dexie-react-hooks keeps its previous result across a dependency
            change, so without a remount the old day's meals, calories and protein paint under the
            new day's heading until IndexedDB answers — and the Loading branch, which exists to say
            exactly that, never shows after first mount. */}
        <DayBody key={date} date={date} today={today} isToday={isToday} onMenu={setMenuFor} />

        <div className="h-4" />
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <Button size="lg" variant="primary" full onClick={() => nav(`/food/new?date=${date}`)} data-testid="add-meal-button">
            Add meal
          </Button>
          {/* Most food is repeat food. Composing yesterday's breakfast again from scratch is six
              taps; this is two. */}
          <Button size="lg" variant="secondary" onClick={() => setRepeatOpen(true)} data-testid="repeat-meal">
            Repeat
          </Button>
        </div>
        <div className="h-8" />
      </div>

      <RepeatSheet open={repeatOpen} date={date} onClose={() => setRepeatOpen(false)} />

      <Sheet open={menuFor !== null} onClose={() => setMenuFor(null)} title={menuFor?.meal.name}>
        <div className="grid gap-3">
          <Button
            size="lg"
            full
            disabled={copying}
            onClick={async () => {
              // Close the sheet and latch BEFORE the await. Copying reads a meal and writes two
              // tables; leaving the button live and the sheet open for that whole round trip is
              // exactly the moment a second tap lands, and repeatMeal mints a new id every call,
              // so the day quietly gains two identical meals.
              const source = menuFor;
              if (!source || copying) return;
              setCopying(true);
              setMenuFor(null);
              try {
                const id = await repeatMeal(source.meal.id, today);
                if (id) {
                  toast('Copied to today');
                  nav(`/food/${id}`);
                }
              } finally {
                setCopying(false);
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

function capitalise(s: string): string {
  return s[0]!.toUpperCase() + s.slice(1);
}

/**
 * Everything that depends on which day is shown. Mounted with `key={date}` so its live queries
 * start clean on every day change rather than replaying the previous day's answer.
 */
function DayBody({
  date,
  today,
  isToday,
  onMenu,
}: {
  date: string;
  today: string;
  isToday: boolean;
  onMenu: (m: MealWithItems) => void;
}) {
  const nav = useNavigate();
  const settings = useSettings();
  const meals = useDayMeals(date);
  const view = useLiveQuery(async () => (settings ? dayView(date, settings, today) : undefined), [date, settings, today]);
  const eaten = view?.eaten ?? ZERO;

  return (
    <>
      {view?.legDay && (
        <div className="pb-2 text-center text-xs font-bold uppercase tracking-[0.12em] text-muted">
          {view.legDayBasis === 'planned' ? 'Leg day (planned)' : 'Leg day'}
        </div>
      )}

      <Card className="p-4">
        <TargetBar label="Calories" value={eaten.kcal} target={view?.calories?.kcal ?? null} unit="kcal" testId="calories-bar" />
        <div className="h-4" />
        <TargetBar label="Protein" value={eaten.protein} target={view?.proteinTarget ?? null} unit="g" tone="ok" testId="protein-bar" />
        <div className="h-4" />
        <MacroSplit m={eaten} />
        <div className="mt-2 flex items-center justify-between text-xs text-muted">
          <MacroLine m={eaten} />
          {view?.calories && (
            // Over the target says so. Clamping this at zero would have been the tidy lie the
            // bar itself is written not to tell.
            <span className={`num tabular-nums ${eaten.kcal > view.calories.kcal ? 'text-warn' : ''}`} data-testid="remaining">
              {eaten.kcal > view.calories.kcal
                ? `${fmtKcal(eaten.kcal - view.calories.kcal)} over`
                : `${fmtKcal(view.calories.kcal - eaten.kcal)} left`}
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
                subtitle={<MealSubtitle m={m} />}
                right={
                  <div className="flex items-center gap-1">
                    <div className="text-right">
                      <div className="num font-extrabold tabular-nums">{fmtKcal(m.macros.kcal)}</div>
                      <MacroLine m={m.macros} className="text-[11px] text-muted" />
                    </div>
                    <IconButton label={`More for ${m.meal.name}`} onClick={() => onMenu(m)} data-testid={`meal-more-${m.meal.name}`}>
                      <MoreIcon />
                    </IconButton>
                  </div>
                }
              />
            </div>
          ))}
        </Card>
      )}
    </>
  );
}

/**
 * Slot, time and item count. The time is shown only when the meal was recorded on the day it
 * counts towards: on a back-filled day `loggedAt` is when it was typed, so printing it next to the
 * slot would assert that Monday's dinner was eaten at 09:14 on Tuesday.
 */
function MealSubtitle({ m }: { m: MealWithItems }) {
  const sameDay = isoToDateKey(m.meal.loggedAt) === m.meal.date;
  const parts = [m.meal.slot ? capitalise(m.meal.slot) : '', sameDay ? fmtTime(m.meal.loggedAt) : ''].filter(Boolean);
  parts.push(`${m.items.length} ${m.items.length === 1 ? 'item' : 'items'}`);
  return <span>{parts.join(' · ')}</span>;
}

/** Pick a meal eaten before and put it on this day. */
function RepeatSheet({ open, date, onClose }: { open: boolean; date: string; onClose: () => void }) {
  const nav = useNavigate();
  const recent = useRecentMeals(open ? date : '', 8);
  const [busy, setBusy] = useState(false);

  const repeat = async (m: MealWithItems) => {
    // Latched and closed before the await, like every other write-then-navigate here: repeatMeal
    // mints a new id per call, so a second tap would put the meal on the day twice.
    if (busy) return;
    setBusy(true);
    onClose();
    try {
      const id = await repeatMeal(m.meal.id, date);
      if (id) {
        toast('Meal added');
        nav(`/food/${id}`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Repeat a meal">
      {recent === undefined && <div className="py-6 text-center text-sm text-muted">Loading…</div>}
      {recent && recent.length === 0 && <EmptyState>Nothing to repeat yet.</EmptyState>}
      {recent && recent.length > 0 && (
        <Card>
          {recent.map((m, i) => (
            <div key={m.meal.id}>
              {i > 0 && <Divider />}
              <Row
                onClick={() => void repeat(m)}
                title={m.meal.name}
                subtitle={m.items.map((it) => it.name).join(', ')}
                right={
                  <div className="text-right">
                    <div className="num font-extrabold tabular-nums">{fmtKcal(m.macros.kcal)}</div>
                    <MacroLine m={m.macros} className="text-[11px] text-muted" />
                  </div>
                }
              />
            </div>
          ))}
        </Card>
      )}
    </Sheet>
  );
}
