import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REMINDERS,
  HORIZON_DAYS,
  REMINDER_ID_FIRST,
  REMINDER_ID_LAST,
  isReminderId,
  planReminders,
  regionRecency,
  resolveReminders,
  type ReminderInput,
  type ReminderPrefs,
} from './reminders';
import type { MuscleSetRow } from './volume';

// Monday 12 October 2026, 09:00 local time. Every date below is built from local components, so the
// suite means the same in any time zone.
const MON_MORNING = new Date(2026, 9, 12, 9, 0);
const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m).toISOString();

const EMPTY: ReminderInput = { meals: [], lastSessionDate: null, muscleRows: [], bodyweightDates: [] };
const input = (o: Partial<ReminderInput> = {}): ReminderInput => ({ ...EMPTY, ...o });
const prefs = (
  o: { food?: Partial<ReminderPrefs['food']>; training?: Partial<ReminderPrefs['training']>; weighIn?: Partial<ReminderPrefs['weighIn']>; supplements?: Partial<ReminderPrefs['supplements']> } = {},
): ReminderPrefs => ({
  food: { ...DEFAULT_REMINDERS.food, ...o.food },
  training: { ...DEFAULT_REMINDERS.training, ...o.training },
  weighIn: { ...DEFAULT_REMINDERS.weighIn, ...o.weighIn },
  supplements: { ...DEFAULT_REMINDERS.supplements, ...o.supplements },
});
const only = (kind: 'Food' | 'Training' | 'Weigh-in') => (r: { title: string }) => r.title === kind;
const dayOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const row = (muscleGroup: MuscleSetRow['muscleGroup'], day: number): MuscleSetRow => ({ muscleGroup, type: 'working', completedAt: at(day, 12) });

describe('food reminder', () => {
  it('is every evening at the chosen time for the next seven days, today included', () => {
    const plan = planReminders(input(), MON_MORNING, prefs()).filter(only('Food'));
    expect(plan).toHaveLength(HORIZON_DAYS);
    expect(plan.map((r) => dayOf(r.at))).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']);
    for (const r of plan) expect([r.at.getHours(), r.at.getMinutes()]).toEqual([20, 30]);
  });

  it('leaves out a time already past, so tonight is dropped after 20:30', () => {
    const late = new Date(2026, 9, 12, 21, 0);
    const plan = planReminders(input(), late, prefs()).filter(only('Food'));
    expect(plan).toHaveLength(6);
    expect(dayOf(plan[0].at)).toBe('2026-10-13');
  });

  it('is skipped for a day once something is logged for it from 17:00, and only that day', () => {
    const plan = planReminders(input({ meals: [{ date: '2026-10-12', loggedAt: at(12, 18, 15), kcal: 700 }] }), MON_MORNING, prefs()).filter(only('Food'));
    expect(plan.map((r) => dayOf(r.at))).not.toContain('2026-10-12');
    expect(plan).toHaveLength(6);
  });

  it('counts 17:00 exactly as the evening, and 16:59 as not', () => {
    const base = (h: number, m: number) => planReminders(input({ meals: [{ date: '2026-10-12', loggedAt: at(12, h, m), kcal: 500 }] }), MON_MORNING, prefs()).filter(only('Food'));
    expect(base(17, 0)).toHaveLength(6);
    expect(base(16, 59)).toHaveLength(7);
  });

  it('is not skipped by food logged earlier in the day, which it reports', () => {
    const plan = planReminders(input({ meals: [{ date: '2026-10-12', loggedAt: at(12, 8, 10), kcal: 600 }, { date: '2026-10-12', loggedAt: at(12, 13, 0), kcal: 850 }] }), MON_MORNING, prefs()).filter(only('Food'));
    expect(plan).toHaveLength(7);
    expect(plan[0].body).toBe("Log today's food: 1,450 kcal so far");
  });

  it('says nothing is logged when nothing is, with no figure in it', () => {
    const [today] = planReminders(input(), MON_MORNING, prefs()).filter(only('Food'));
    expect(today.body).toBe('Nothing logged yet today');
    expect(today.title).toBe('Food');
  });

  it('rounds the calories and puts a thousands separator in', () => {
    const [today] = planReminders(input({ meals: [{ date: '2026-10-12', loggedAt: at(12, 9, 0), kcal: 1449.6 }] }), MON_MORNING, prefs()).filter(only('Food'));
    expect(today.body).toBe("Log today's food: 1,450 kcal so far");
  });

  it("is not skipped by an evening entry that counts towards another day", () => {
    const plan = planReminders(
      input({
        meals: [
          // Yesterday's dinner, typed in this evening, counts towards yesterday.
          { date: '2026-10-11', loggedAt: at(12, 19, 0), kcal: 900 },
          // A meal entered this evening for tomorrow counts towards tomorrow.
          { date: '2026-10-13', loggedAt: at(12, 18, 0), kcal: 300 },
        ],
      }),
      MON_MORNING,
      prefs(),
    ).filter(only('Food'));
    expect(plan.map((r) => dayOf(r.at))).toContain('2026-10-12');
    expect(plan.find((r) => dayOf(r.at) === '2026-10-13')?.body).toBe("Log today's food: 300 kcal so far");
  });

  it('is off when switched off, and follows a changed time', () => {
    expect(planReminders(input(), MON_MORNING, prefs({ food: { on: false } })).filter(only('Food'))).toEqual([]);
    const [first] = planReminders(input(), MON_MORNING, prefs({ food: { time: '21:15' } })).filter(only('Food'));
    expect([first.at.getHours(), first.at.getMinutes()]).toEqual([21, 15]);
  });
});

describe('training reminder', () => {
  const trained = (lastSessionDate: string | null, muscleRows: MuscleSetRow[] = [], p = prefs()) =>
    planReminders(input({ lastSessionDate, muscleRows }), MON_MORNING, p).filter(only('Training'));

  it('waits for the gap: two days after a Saturday session is Monday evening', () => {
    const plan = trained('2026-10-10');
    expect(plan).toHaveLength(7);
    expect(dayOf(plan[0].at)).toBe('2026-10-12');
    expect([plan[0].at.getHours(), plan[0].at.getMinutes()]).toEqual([17, 30]);
  });

  it('starts the day after when the last session was yesterday, and two days on when it was today', () => {
    expect(dayOf(trained('2026-10-11')[0].at)).toBe('2026-10-13');
    expect(dayOf(trained('2026-10-12')[0].at)).toBe('2026-10-14');
  });

  it('follows a longer gap setting', () => {
    expect(dayOf(trained('2026-10-10', [], prefs({ training: { afterDays: 4 } }))[0].at)).toBe('2026-10-14');
  });

  it('does not nag someone who has never trained, or has switched it off', () => {
    expect(trained(null)).toEqual([]);
    expect(trained('2026-10-01', [], prefs({ training: { on: false } }))).toEqual([]);
  });

  it('names a region not trained for a week, with how long, longest first', () => {
    const rows = [
      row('quads', 3), // legs: 9 days
      row('lats', 5), // back: 7 days
      row('chest', 10), // 2 days
      row('shoulders', 11),
      row('biceps', 11),
    ];
    const [today] = trained('2026-10-11', rows, prefs({ training: { afterDays: 1 } }));
    expect(today.title).toBe('Training');
    expect(today.body).toBe('Legs last trained 9 days ago. Back last trained 7 days ago');
  });

  it('does not name a region until it has gone a full week', () => {
    const [today] = trained('2026-10-10', [row('quads', 6), row('lats', 6), row('chest', 6), row('shoulders', 6), row('biceps', 6)]);
    expect(today.body).toBe('Last session was 2 days ago');
  });

  it('counts a region as trained when any of its muscles was', () => {
    // Quads left for nine days, but calves were worked three days ago: legs have been trained.
    const [today] = trained('2026-10-09', [row('quads', 3), row('calves', 9), row('chest', 9), row('lats', 9), row('shoulders', 9), row('triceps', 9)]);
    expect(today.body).not.toMatch(/Legs/);
  });

  it('maps every muscle group the app has to a region, or to none on purpose', () => {
    expect(regionRecency({ hamstrings: 4, glutes: 2, 'lower back': 9, traps: 8, 'rear delts': 5, forearms: 1, abs: 30, neck: 30, 'full body': 0, other: 0 })).toEqual({
      legs: 2,
      back: 8,
      shoulders: 5,
      arms: 1,
    });
  });

  it('counts the days as of the day it will arrive, so tomorrow says one more', () => {
    const plan = trained('2026-10-10', [row('quads', 3), row('chest', 11), row('lats', 11), row('shoulders', 11), row('biceps', 11)]);
    expect(plan[0].body).toBe('Legs last trained 9 days ago');
    expect(plan[1].body).toBe('Legs last trained 10 days ago');
  });

  it('names at most three regions', () => {
    const [today] = trained('2026-10-01', [row('quads', 1), row('lats', 2), row('chest', 3), row('shoulders', 4), row('biceps', 5)]);
    expect(today.body.split('. ')).toHaveLength(3);
    expect(today.body.startsWith('Legs last trained 11 days ago')).toBe(true);
  });
});

describe('weigh-in reminder', () => {
  const weigh = (bodyweightDates: string[], now = MON_MORNING, p = prefs()) => planReminders(input({ bodyweightDates }), now, p).filter(only('Weigh-in'));

  it('is Monday at noon by default', () => {
    const [w] = weigh([]);
    expect(dayOf(w.at)).toBe('2026-10-12');
    expect([w.at.getHours(), w.at.getMinutes()]).toEqual([12, 0]);
    expect(w).toMatchObject({ title: 'Weigh-in', body: "Log this week's weight" });
  });

  it('is skipped once weighed in that week', () => {
    expect(weigh(['2026-10-12'])).toEqual([]);
  });

  it('is not skipped by last week, nor by a reading on Sunday before the week began', () => {
    expect(weigh(['2026-10-11', '2026-10-05'])).toHaveLength(1);
  });

  it('is only the one in the next seven days, so a Monday morning does not plan the next Monday', () => {
    expect(weigh([])).toHaveLength(1);
    // Tuesday morning: Monday has gone, and next Monday (6 days on) is inside the window.
    const [next] = weigh([], new Date(2026, 9, 13, 9, 0));
    expect(dayOf(next.at)).toBe('2026-10-19');
  });

  it('is dropped when its time has passed', () => {
    expect(weigh([], new Date(2026, 9, 12, 12, 30))).toEqual([]);
  });

  it('follows the chosen weekday, and counts a weigh-in from earlier in the same Monday-to-Sunday week', () => {
    const friday = prefs({ weighIn: { weekday: 5, time: '07:45' } });
    const [w] = weigh([], MON_MORNING, friday);
    expect([dayOf(w.at), w.at.getHours(), w.at.getMinutes()]).toEqual(['2026-10-16', 7, 45]);
    expect(weigh(['2026-10-14'], MON_MORNING, friday)).toEqual([]);
    expect(weigh(['2026-10-09'], MON_MORNING, friday)).toHaveLength(1);
  });

  it('treats Sunday as the last day of its week', () => {
    const sunday = prefs({ weighIn: { weekday: 0 } });
    expect(weigh(['2026-10-13'], MON_MORNING, sunday)).toEqual([]);
    expect(weigh([], MON_MORNING, sunday)).toHaveLength(1);
  });

  it('is off when switched off', () => {
    expect(weigh([], MON_MORNING, prefs({ weighIn: { on: false } }))).toEqual([]);
  });
});

describe('the plan as a whole', () => {
  const busy = planReminders(
    input({ lastSessionDate: '2026-10-05', muscleRows: [row('quads', 5), row('chest', 5)], meals: [{ date: '2026-10-12', loggedAt: at(12, 8, 0), kcal: 500 }] }),
    MON_MORNING,
    prefs(),
  );

  it('stays inside seven days from now and is in time order', () => {
    expect(busy.length).toBeGreaterThan(10);
    const end = new Date(2026, 9, 19, 0, 0).getTime();
    for (const r of busy) {
      expect(r.at.getTime()).toBeGreaterThan(MON_MORNING.getTime());
      expect(r.at.getTime()).toBeLessThan(end);
    }
    expect(busy.map((r) => r.at.getTime())).toEqual([...busy.map((r) => r.at.getTime())].sort((a, b) => a - b));
  });

  it('gives every reminder an id in Iron\'s range, none of them the rest timer\'s, and no two the same', () => {
    const ids = busy.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(isReminderId(id)).toBe(true);
      expect(id).toBeGreaterThanOrEqual(REMINDER_ID_FIRST);
      expect(id).toBeLessThanOrEqual(REMINDER_ID_LAST);
      expect(id).not.toBe(7001);
    }
    expect(isReminderId(7001)).toBe(false);
  });

  it('gives the same ids for the same plan, and the same id to the same weekday a day later', () => {
    const again = planReminders(
      input({ lastSessionDate: '2026-10-05', muscleRows: [row('quads', 5), row('chest', 5)], meals: [{ date: '2026-10-12', loggedAt: at(12, 8, 0), kcal: 500 }] }),
      MON_MORNING,
      prefs(),
    );
    expect(again.map((r) => r.id)).toEqual(busy.map((r) => r.id));
    // The Wednesday food reminder is the same notification whether planned on Monday or Tuesday.
    const wedFrom = (now: Date) => planReminders(input(), now, prefs()).find((r) => r.title === 'Food' && dayOf(r.at) === '2026-10-14')!.id;
    expect(wedFrom(MON_MORNING)).toBe(wedFrom(new Date(2026, 9, 13, 9, 0)));
  });

  it('uses a different id for each kind on the same day', () => {
    const monday = busy.filter((r) => dayOf(r.at) === '2026-10-12');
    expect(monday.map((r) => r.title).sort()).toEqual(['Food', 'Training', 'Weigh-in']);
    expect(new Set(monday.map((r) => r.id)).size).toBe(3);
  });

  it('is empty with everything switched off', () => {
    const off = prefs({ food: { on: false }, training: { on: false }, weighIn: { on: false } });
    expect(planReminders(input({ lastSessionDate: '2026-10-01' }), MON_MORNING, off)).toEqual([]);
  });

  it('writes plain British text: no exclamation marks, nothing outside ASCII', () => {
    for (const r of busy) {
      expect(`${r.title} ${r.body}`).not.toContain('!');
      expect(`${r.title} ${r.body}`).toMatch(/^[\x20-\x7e]+$/);
    }
  });
});

describe('resolveReminders', () => {
  it('is the defaults for nothing stored, and fills the parts a stored row lacks', () => {
    expect(resolveReminders(undefined)).toEqual(DEFAULT_REMINDERS);
    expect(resolveReminders({ food: { on: false } })).toEqual({ ...DEFAULT_REMINDERS, food: { on: false, time: '20:30' } });
  });

  it('replaces a malformed time, weekday or gap with the default', () => {
    const r = resolveReminders({ food: { time: '25:99' }, training: { afterDays: 0 }, weighIn: { weekday: 9, time: '7:5' } });
    expect(r).toEqual(DEFAULT_REMINDERS);
  });

  it('documents the defaults the owner asked for', () => {
    expect(DEFAULT_REMINDERS).toEqual({
      food: { on: true, time: '20:30' },
      training: { on: true, time: '17:30', afterDays: 2 },
      weighIn: { on: true, weekday: 1, time: '12:00' },
      supplements: { on: true, time: '08:30' },
    });
  });
});

describe('supplements reminder', () => {
  const only = prefs({ food: { on: false }, training: { on: false }, weighIn: { on: false } });
  const labels = [
    { id: 'c', label: 'Creatine 5 g' },
    { id: 'd', label: 'Vitamin D' },
    { id: 'm', label: 'Magnesium' },
    { id: 'f', label: 'Fish oil' },
  ];

  it('says nothing with an empty list', () => {
    expect(planReminders(input({ supplements: { labels: [], takenOn: {} } }), MON_MORNING, only)).toEqual([]);
    expect(planReminders(input(), MON_MORNING, only)).toEqual([]);
  });

  it('names what is left each day at the set time, from tomorrow when today\'s time has passed', () => {
    const plan = planReminders(input({ supplements: { labels: labels.slice(0, 2), takenOn: {} } }), MON_MORNING, only);
    expect(plan).toHaveLength(6);
    expect(plan[0]).toMatchObject({ title: 'Supplements', body: 'Creatine 5 g, Vitamin D' });
    expect([plan[0].at.getDate(), plan[0].at.getHours(), plan[0].at.getMinutes()]).toEqual([13, 8, 30]);
  });

  it('counts what is left of a partly ticked day, and skips a fully ticked one', () => {
    const early = new Date(2026, 9, 12, 7, 0);
    const partly = planReminders(input({ supplements: { labels, takenOn: { '2026-10-12': ['c'] } } }), early, only);
    expect(partly[0].body).toBe('3 of 4 left: Vitamin D, Magnesium, Fish oil');
    expect(partly[1].body).toBe('Creatine 5 g, Vitamin D, Magnesium and 1 more');
    const all = planReminders(input({ supplements: { labels, takenOn: { '2026-10-12': ['c', 'd', 'm', 'f'] } } }), early, only);
    expect(all[0].at.getDate()).toBe(13);
  });

  it('stays in Iron\'s id range and off when switched off', () => {
    const plan = planReminders(input({ supplements: { labels, takenOn: {} } }), MON_MORNING, only);
    for (const r of plan) expect(r.id >= 8130 && r.id <= REMINDER_ID_LAST).toBe(true);
    expect(planReminders(input({ supplements: { labels, takenOn: {} } }), MON_MORNING, prefs({ food: { on: false }, training: { on: false }, weighIn: { on: false }, supplements: { on: false } }))).toEqual([]);
  });

  it('fills in a missing or malformed stored setting', () => {
    expect(resolveReminders({ supplements: { time: '25:00' } }).supplements).toEqual(DEFAULT_REMINDERS.supplements);
    expect(resolveReminders({ supplements: { on: false, time: '07:05' } }).supplements).toEqual({ on: false, time: '07:05' });
  });
});
