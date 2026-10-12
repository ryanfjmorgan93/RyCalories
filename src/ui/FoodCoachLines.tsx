import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { hashFacts } from '@/ai/moments';
import { dayView } from '@/db/todayQueries';
import { dayCommentDue, dayMomentFacts } from '@/domain/foodFacts';
import { freshMoment, useMealMoment } from '@/state/mealMoment';
import { CoachLine } from './CoachLine';
import { useDayMeals, useNow, useSettings } from './hooks';

/**
 * The coach on the Food screen, under the day's summary: a word on the meal just logged (by any
 * route), or, late in the evening with the day's food in, a word on the day. Both are the coach's
 * to give or hold back (`CoachLine` shows nothing when it has nothing to say, when there is no key
 * or signal, or at the spend cap), and neither takes any room until a line arrives.
 *
 * Only one at a time: right after a meal the comment is about that meal (the day's waits, even while
 * the meal's is still waiting out the Undo window), and the day's comes on a later visit, so an
 * evening dinner is not remarked on twice.
 */
export function FoodCoachLines({ date, today }: { date: string; today: string }) {
  const moment = freshMoment(useMealMoment((s) => s.moment));
  const pending = useMealMoment((s) => s.pending);
  if (moment && moment.date === date) {
    return <CoachLine moment="meal" facts={moment.facts} className="mt-3" testId="coach-line-meal" />;
  }
  return pending ? null : <DayLine date={date} today={today} />;
}

/** How long the day's food must hold still before the coach is asked about it, so a meal being logged right now is not remarked on as a day. */
export const DAY_SETTLE_MS = 3000;

/** True once `value` has stayed the same for `ms`. */
function useSettled(value: string, ms: number): boolean {
  const [settled, setSettled] = useState<string | null>(null);
  useEffect(() => {
    const id = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return settled === value;
}

function DayLine({ date, today }: { date: string; today: string }) {
  const isToday = date === today;
  const settings = useSettings();
  const meals = useDayMeals(date);
  const view = useLiveQuery(async () => (settings ? dayView(date, settings, today) : undefined), [date, settings, today]);
  // Once a minute is plenty to notice that it has gone eight o'clock.
  const now = useNow(60_000, isToday);

  const due = !!meals && !!view && dayCommentDue({ isToday, now: new Date(now), mealCount: meals.length });
  const facts = due ? dayMomentFacts(meals, { eaten: view.eaten, kcalTarget: view.calories?.kcal ?? null, proteinTarget: view.proteinTarget }) : null;
  const settled = useSettled(facts ? hashFacts(facts) : '', DAY_SETTLE_MS);
  if (!facts) return null;
  return <CoachLine moment="day" facts={facts} ask={settled} className="mt-3" testId="coach-line-day" />;
}
