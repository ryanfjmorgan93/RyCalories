import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { addDays, isoToDateKey } from '@/domain/dates';
import { fmtDayKey, fmtGrams, fmtKcal, fmtNum, fmtTime, plural } from '@/domain/format';
import { ESTIMATE_MARK, isEstimate } from '@/domain/claudeFood';
import { ZERO, addMacros, displayMacros } from '@/domain/food';
import { defaultSlot } from '@/domain/mealSlot';
import { mealSignature, type OfferedUsual } from '@/domain/usualMeals';
import type { LabelNutrition } from '@/domain/products';
import type { MealItem, MealSlot } from '@/domain/types';
import { sweepKeptPhotos } from '@/state/claudeFood';
import { noteMealLogged } from '@/state/mealMoment';
import { dayView } from '@/db/todayQueries';
import { foodDays } from '@/db/gameQueries';
import { foodLadders } from '@/domain/badges';
import {
  copyDay,
  deleteItem,
  deleteMeal,
  logUsual,
  mealCountOnDay,
  removeUsual,
  repeatMeal,
  restoreItem,
  restoreMeal,
  saveUsual,
  sumItems,
  updateItem,
  usualsOn,
  type MealWithItems,
  type NewMealItem,
} from '@/db/foodRepo';
import { Button, IconButton } from '@/ui/components/Button';
import { Card, Divider, EmptyState, Row, SectionTitle } from '@/ui/components/Card';
import { MacroLine, MacroSplit, TargetBar } from '@/ui/components/MacroBar';
import { Confirm, Sheet } from '@/ui/components/Sheet';
import { toast } from '@/ui/components/Toast';
import { BackIcon, ChevronIcon, MoreIcon, TopBar } from '@/ui/components/TopBar';
import { AddFoodSheet } from '@/ui/AddFoodSheet';
import { FoodCoachLines } from '@/ui/FoodCoachLines';
import { FoodItemSheet } from '@/ui/FoodItemSheet';
import { HexPanel, Segments } from '@/ui/GameMarks';
import { FoodWeekStrip } from '@/ui/FoodWeekStrip';
import { useDayMeals, useRecentMeals, useSettings, useToday } from '@/ui/hooks';
import { useClaudeFood } from '@/ui/useClaudeFood';
import { itemPatch } from './MealEditScreen';

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
  const settings = useSettings();
  // The saved usual this meal is, if it is one: the menu then offers to remove it instead.
  const menuKey = menuFor ? mealSignature(menuFor.meal.name, menuFor.items) : null;
  const menuUsual = menuKey === null ? undefined : (settings?.usualMeals ?? []).find((u) => mealSignature(u.name, u.items) === menuKey);
  // The Add food sheet: closed (null), or open. A reader (photo, label) that closed it brings it back
  // on the same slot, and a label it read opens straight on the amount step.
  const [addFood, setAddFood] = useState<{ slot?: MealSlot; label?: LabelNutrition } | null>(null);
  const claude = useClaudeFood({
    reopen: (ctx) => setAddFood({ slot: ctx.slot }),
    onLabel: (ctx, label) => setAddFood({ slot: ctx.slot, label }),
  });

  // Kept meal photos whose meal is gone (undone or deleted) are tidied away when the screen opens.
  useEffect(() => {
    void sweepKeptPhotos();
  }, []);

  // Roll the view onto the new day if the app is left open past midnight, but only while
  // looking at today — never yank the screen away from a day being edited.
  //
  // This needs the PREVIOUS value of `today` to know whether the user was looking at "today".
  // Comparing against the new value cannot work: by the time the effect runs, `today` is already
  // the new day, so `d === today` is false for the very screen that should move, and the whole
  // effect collapses into a no-op. Left that way, a meal added at 00:20 is written to yesterday.
  // The old day is read into a local first: React may run the updater later, after the ref has moved on.
  const prevToday = useRef(today);
  useEffect(() => {
    const was = prevToday.current;
    prevToday.current = today;
    setDate((d) => (d === was ? today : d));
  }, [today]);

  const yesterday = addDays(today, -1);
  const isToday = date === today;

  // "Copy yesterday" shows on an empty day whose previous day has food. Both counts come from one
  // live query that says which day it answered for: dexie-react-hooks keeps its previous result
  // across a dependency change, so trusting a stale answer could offer the button on a day that
  // already has meals, for the length of one IndexedDB round trip.
  const dayBefore = addDays(date, -1);
  const counts = useLiveQuery(
    async () => ({ date, dayBefore, shown: await mealCountOnDay(date), before: await mealCountOnDay(dayBefore) }),
    [date, dayBefore],
  );
  const copyable = counts && counts.date === date && counts.dayBefore === dayBefore && counts.shown === 0 ? counts.before : 0;
  const [copyingDay, setCopyingDay] = useState(false);
  const copyPreviousDay = async () => {
    // Latched before the await: copyDay mints new ids on every call, so a second tap would put
    // the whole day onto this one twice.
    if (copyingDay) return;
    setCopyingDay(true);
    try {
      const n = await copyDay(dayBefore, date);
      if (n > 0) toast(`Copied ${plural(n, 'meal')}`);
    } catch {
      toast('Could not copy the day', 'danger');
    } finally {
      setCopyingDay(false);
    }
  };

  return (
    <div>
      <TopBar title="Food" />

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
            className="min-w-0 flex-1 break-words py-2 text-center text-lg disabled:opacity-100"
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
            exactly that, never shows after first mount. The week strip between the two halves is
            NOT keyed: it reads a window ending on the day, and keeping it mounted lets it move from
            one window to the next without blanking. The actions sit above the meals, so Add food
            stays in reach however long the day's list grows; the week sits under them. */}
        <DaySummary key={`summary-${date}`} date={date} today={today} />
        <FoodCoachLines date={date} today={today} />
        {isToday && <Usuals date={date} />}
        <div className="h-4" />

        {copyable > 0 && (
          // Its own full-width row above the others: "Copy yesterday · 2 meals" does not fit
          // beside Repeat and Recipes on a phone. It says "yesterday" only while today is the day
          // shown; on any other day the source is the day before that one, and it says so.
          <div className="pb-3">
            <Button size="lg" variant="secondary" full disabled={copyingDay} onClick={() => void copyPreviousDay()} data-testid="copy-yesterday">
              {`Copy ${isToday ? 'yesterday' : 'day before'} · ${plural(copyable, 'meal')}`}
            </Button>
          </div>
        )}
        {/* One button for the usual case: search or scan, tap an amount, done. Meals stay the
            grouping — Add meal is still here, for composing one by hand. */}
        <Button size="lg" variant="primary" full onClick={() => setAddFood({})} data-testid="add-food-button">
          Add food
        </Button>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <Button size="lg" variant="secondary" full className="px-2 text-base" onClick={() => nav(`/food/new?date=${date}`)} data-testid="add-meal-button">
            Add meal
          </Button>
          {/* Most food is repeat food. Composing yesterday's breakfast again from scratch is six
              taps; this is two. */}
          <Button size="lg" variant="secondary" full className="px-2 text-base" onClick={() => setRepeatOpen(true)} data-testid="repeat-meal">
            Copy a meal
          </Button>
          <Button size="lg" variant="secondary" full className="px-2 text-base" onClick={() => nav(`/food/recipes?date=${date}`)} data-testid="recipes-button">
            Recipes
          </Button>
        </div>
        <div className="h-4" />
        <DayMeals key={`meals-${date}`} date={date} isToday={isToday} onMenu={setMenuFor} />
        <div className="h-4" />
        <FoodWeekStrip date={date} today={today} onPick={setDate} />
        <div className="h-8" />
      </div>

      {addFood && (
        <AddFoodSheet
          date={date}
          {...(addFood.slot ? { slot: addFood.slot } : {})}
          {...(addFood.label ? { start: addFood.label } : {})}
          onClose={() => setAddFood(null)}
          onPhoto={claude.onPhoto}
          onDescribe={claude.onDescribe}
          onSnapLabel={claude.onSnapLabel}
          onLogged={(logged) => noteMealLogged({ mealId: logged.mealId, itemIds: logged.itemIds })}
        />
      )}
      {claude.host}

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
          {menuFor && menuFor.items.length > 0 && (
            <Button
              size="lg"
              full
              onClick={async () => {
                const source = menuFor;
                setMenuFor(null);
                if (menuUsual) {
                  await removeUsual(menuUsual.id);
                  toast('Removed from your usuals');
                } else {
                  await saveUsual(source);
                  toast('Saved as a usual', 'ok');
                }
              }}
              data-testid="usual-toggle"
            >
              {menuUsual ? 'Remove from usuals' : 'Save as usual'}
            </Button>
          )}
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
          const gone = deleteFor;
          await deleteMeal(gone.meal.id);
          setDeleteFor(null);
          toast('Meal deleted', 'neutral', { label: 'Undo', onClick: () => void restoreMeal(gone) });
        }}
      />
    </div>
  );
}

function capitalise(s: string): string {
  return s[0]!.toUpperCase() + s.slice(1);
}

const SLOT_PLURAL: Record<MealSlot, string> = { breakfast: 'breakfasts', lunch: 'lunches', dinner: 'dinners', snack: 'snacks' };

/**
 * Today's usual meals for the time of day (domain/usualMeals.ts): the ones saved, then the ones the
 * owner's own history shows. One tap logs one, with an Undo; nothing already on the day is offered.
 */
function Usuals({ date }: { date: string }) {
  const slot = defaultSlot();
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

/**
 * The day's targets and what has been eaten against them. Mounted with `key` by the day, so its
 * live queries start clean on every day change rather than replaying the previous day's answer.
 */
function DaySummary({ date, today }: { date: string; today: string }) {
  const settings = useSettings();
  const view = useLiveQuery(async () => (settings ? dayView(date, settings, today) : undefined), [date, settings, today]);
  const eaten = view?.eaten ?? ZERO;
  const hit = view !== undefined && view.proteinTarget > 0 && eaten.protein >= view.proteinTarget;
  // The ladder the day counts towards, read only once the day has hit (it sweeps every day of food).
  const ladder = useLiveQuery(async () => (hit && settings ? foodLadders(await foodDays(settings)).find((l) => l.id === 'protein-days') : undefined), [hit, settings, eaten.protein]);

  return (
    <>
      {view?.legDay && (
        <div className="label pb-3 text-center">
          {view.legDayBasis === 'planned' ? 'Leg day (planned)' : 'Leg day'}
        </div>
      )}

      {hit && view && (
        <HexPanel
          mark={
            <>
              <span className="num text-lg font-medium leading-none">{fmtNum(view.proteinTarget)}</span>
              <span className="mt-0.5 text-[9px] font-semibold tracking-[0.1em]">G</span>
            </>
          }
          title="Protein hit"
          detail={`${fmtGrams(eaten.protein)} of ${fmtGrams(view.proteinTarget)}`}
          className="mb-3"
          testId="protein-hit"
        >
          {ladder?.next && (
            <>
              <Segments percent={Math.min(99, Math.floor(ladder.next.done * 100 + 1e-6))} label={`To ${ladder.next.name}`} className="mt-3 h-2" />
              <div className="num mt-1.5 flex justify-between text-xs text-muted">
                <span>{ladder.next.name}</span>
                <span className="text-accent">{ladder.next.toGo}</span>
              </div>
            </>
          )}
        </HexPanel>
      )}

      <Card className="px-4 pb-2 pt-1">
        {/* What is left leads, as the two numbers the day is steered by, each over its own bar. Over
            says over: a zero here would be the tidy lie the bars are written not to tell. */}
        <div className="grid grid-cols-2 gap-x-5 gap-y-5">
          <div className="min-w-0">
            {view?.calories && <Left label="Calories" left={view.calories.kcal - eaten.kcal} text={fmtKcal} testId="remaining" />}
            <TargetBar compact label="Calories" value={eaten.kcal} target={view?.calories?.kcal ?? null} unit="kcal" testId="calories-bar" />
          </div>
          <div className="min-w-0">
            {view && view.proteinTarget !== null && <Left label="Protein" left={view.proteinTarget - eaten.protein} text={fmtGrams} testId="protein-left" />}
            <TargetBar compact label="Protein" value={eaten.protein} target={view?.proteinTarget ?? null} unit="g" testId="protein-bar" />
          </div>
          {settings?.carbTarget !== undefined && <TargetBar label="Carbs" value={eaten.carbs} target={settings.carbTarget} unit="g" testId="carbs-bar" />}
          {settings?.fatTarget !== undefined && <TargetBar label="Fat" value={eaten.fat} target={settings.fatTarget} unit="g" testId="fat-bar" />}
        </div>
        <div className="mt-5">
          <MacroSplit m={eaten} />
          <MacroLine m={eaten} className="mt-2 block text-xs text-muted" />
        </div>
      </Card>
    </>
  );
}

/** One of the day's two leading numbers: how much of a target is left, or how far over it the day is. */
function Left({ label, left, text, testId }: { label: string; left: number; text: (n: number) => string; testId: string }) {
  const over = left < 0;
  // "351 kcal" as a big figure and its small unit; the words stay one string for a screen reader.
  const [figure, ...unit] = text(Math.abs(left)).split(' ');
  return (
    <div className="mb-3 min-w-0">
      <div className="label">{label}</div>
      <div className={`num mt-1.5 whitespace-nowrap ${over ? 'text-warn' : ''}`} data-testid={testId}>
        <span className="fig text-[2.75rem]">{figure}</span> <span className="text-sm text-muted">{[...unit, over ? 'over' : 'left'].join(' ')}</span>
      </div>
    </div>
  );
}

/** The day's meals, each one tap from being edited. Keyed by the day, like `DaySummary`. */
function DayMeals({ date, isToday, onMenu }: { date: string; isToday: boolean; onMenu: (m: MealWithItems) => void }) {
  const nav = useNavigate();
  const meals = useDayMeals(date);
  const [editing, setEditing] = useState<MealItem | null>(null);
  const draft: NewMealItem | undefined = editing
    ? { name: editing.name, portion: editing.portion, nutrition: editing.nutrition, source: editing.source, brand: editing.brand, product: editing.product }
    : undefined;

  return (
    <>
      {meals === undefined && <div className="py-8 text-center text-sm text-muted">Loading…</div>}
      {meals && meals.length === 0 && <EmptyState>Nothing logged{isToday ? ' today' : ''}.</EmptyState>}
      {meals && meals.length > 0 && (
        <Card>
          {meals.map((m, i) => (
            <div key={m.meal.id}>
              {i > 0 && <Divider />}
              <Row
                onClick={() => nav(`/food/${m.meal.id}`)}
                testId="meal-row"
                title={<span className="text-xl font-normal tracking-[-0.01em]">{m.meal.name}</span>}
                subtitle={<MealSubtitle m={m} />}
                right={
                  <div className="-mr-2 flex items-center gap-1">
                    <div className="text-right">
                      <div className="num text-lg tabular-nums">
                        {m.items.some(isEstimate) ? `${ESTIMATE_MARK} ` : ''}
                        {fmtKcal(m.macros.kcal)}
                      </div>
                      <MacroLine m={m.macros} className="text-[11px] text-muted" />
                    </div>
                    <IconButton label={`More for ${m.meal.name}`} onClick={() => onMenu(m)} data-testid={`meal-more-${m.meal.name}`}>
                      <MoreIcon />
                    </IconButton>
                  </div>
                }
              />
              {/* The foods in it, each with its amount: a tap opens that food to change or remove, without leaving the day. */}
              {m.items.map((item) => (
                <button key={item.id} type="button" onClick={() => setEditing(item)} className="flex min-h-11 w-full items-center gap-3 px-4 py-1.5 text-left active:bg-surface-2" data-testid="meal-food">
                  <span className="min-w-0 flex-1 truncate text-sm text-fg/85">{item.name}</span>
                  <span className="num max-w-[40%] shrink-0 truncate rounded-full border border-fg/20 px-3 py-1 text-xs">{item.portion}</span>
                  <span className="num w-[4.5rem] shrink-0 text-right text-sm text-muted">
                    {isEstimate(item) ? `${ESTIMATE_MARK} ` : ''}
                    {fmtKcal(sumItems([item]).kcal)}
                  </span>
                </button>
              ))}
              {m.items.length > 0 && <div className="h-1.5" />}
            </div>
          ))}
        </Card>
      )}

      <FoodItemSheet
        key={editing?.id ?? 'none'}
        open={editing !== null}
        item={draft}
        onClose={() => setEditing(null)}
        onDelete={async () => {
          const row = editing;
          setEditing(null);
          if (!row) return;
          await deleteItem(row.id);
          toast(`${row.name} removed`, 'neutral', { label: 'Undo', onClick: () => void restoreItem(row) });
        }}
        onSave={async (item) => {
          const row = editing;
          setEditing(null);
          if (!row) return;
          await updateItem(row.id, itemPatch(item), { ...(item.barcode ? { barcode: item.barcode } : {}), ...(item.units ? { units: item.units } : {}) });
        }}
      />
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
    <Sheet open={open} onClose={onClose} title="Copy a meal">
      {recent === undefined && <div className="py-6 text-center text-sm text-muted">Loading…</div>}
      {recent && recent.length === 0 && <EmptyState>Nothing to copy yet.</EmptyState>}
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
                    <div className="num text-lg tabular-nums">{fmtKcal(m.macros.kcal)}</div>
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
