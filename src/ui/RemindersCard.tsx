import { rescheduleReminders } from '@/platform/reminders';
import { saveSettings } from '@/db/repo';
import { resolveReminders, type ReminderPrefs } from '@/domain/reminders';
import type { Settings } from '@/domain/types';
import { Button } from '@/ui/components/Button';
import { Card, Divider } from '@/ui/components/Card';
import { Segmented, Toggle } from '@/ui/components/Chip';
import { NumberField } from '@/ui/components/NumberField';
import { toast } from '@/ui/components/Toast';
import { canAskForPermission, permissionLabel, useNotificationPermission } from '@/ui/useNotificationPermission';

export interface RemindersCardProps {
  /** The live settings row; the card reads `settings.reminders` and falls back to the defaults. */
  settings: Settings;
}

const WEEKDAYS: { value: string; label: string }[] = [
  { value: '1', label: 'Mon' },
  { value: '2', label: 'Tue' },
  { value: '3', label: 'Wed' },
  { value: '4', label: 'Thu' },
  { value: '5', label: 'Fri' },
  { value: '6', label: 'Sat' },
  { value: '0', label: 'Sun' },
];

/**
 * The three reminders (food, training, weigh-in), each with a switch and its time, the weekday for
 * the weigh-in and the gap for the training nudge, plus the notification permission with the same
 * "Allow notifications" button the rest timer's setting has. Every change is saved at once through
 * `saveSettings` and the schedule on the phone is redone, so what is shown is what will fire.
 */
export function RemindersCard({ settings }: RemindersCardProps) {
  const prefs = resolveReminders(settings.reminders);
  const { perm, native, request } = useNotificationPermission();

  const update = async (next: ReminderPrefs) => {
    await saveSettings({ reminders: next });
    void rescheduleReminders();
    toast('Saved', 'ok');
  };

  const allow = async () => {
    const result = await request();
    if (result === 'granted') void rescheduleReminders();
  };

  return (
    <Card className="px-4" data-testid="reminders-card">
      <Toggle
        label="Food"
        sub="An evening reminder with today's calories so far"
        checked={prefs.food.on}
        onChange={(on) => void update({ ...prefs, food: { ...prefs.food, on } })}
        testId="reminder-food"
      />
      {prefs.food.on && <TimeRow group="Food" value={prefs.food.time} onChange={(time) => void update({ ...prefs, food: { ...prefs.food, time } })} testId="reminder-food-time" />}
      <Divider />

      <Toggle
        label="Training"
        sub="After days without a session, naming any region left a week"
        checked={prefs.training.on}
        onChange={(on) => void update({ ...prefs, training: { ...prefs.training, on } })}
        testId="reminder-training"
      />
      {prefs.training.on && (
        <>
          <TimeRow group="Training" value={prefs.training.time} onChange={(time) => void update({ ...prefs, training: { ...prefs.training, time } })} testId="reminder-training-time" />
          <div className="pb-3">
            <NumberField
              label="Days without a session"
              unit="days"
              value={prefs.training.afterDays}
              step={1}
              min={1}
              max={14}
              mode="numeric"
              size="md"
              testId="reminder-training-days"
              onChange={(afterDays) => {
                if (afterDays !== null) void update({ ...prefs, training: { ...prefs.training, afterDays: Math.round(afterDays) } });
              }}
            />
          </div>
        </>
      )}
      <Divider />

      <Toggle
        label="Weigh-in"
        sub="Weekly, until a weight is logged"
        checked={prefs.weighIn.on}
        onChange={(on) => void update({ ...prefs, weighIn: { ...prefs.weighIn, on } })}
        testId="reminder-weigh-in"
      />
      {prefs.weighIn.on && (
        <>
          <div className="pb-2" data-testid="reminder-weekday">
            <Segmented
              value={String(prefs.weighIn.weekday)}
              onChange={(v) => void update({ ...prefs, weighIn: { ...prefs.weighIn, weekday: Number(v) } })}
              options={WEEKDAYS.map((d) => ({ ...d, testId: `reminder-weekday-${d.value}` }))}
            />
          </div>
          <TimeRow group="Weigh-in" value={prefs.weighIn.time} onChange={(time) => void update({ ...prefs, weighIn: { ...prefs.weighIn, time } })} testId="reminder-weigh-in-time" />
        </>
      )}
      <Divider />

      <div className="py-3" data-testid="reminders-permission">
        <div className="font-semibold">Notification permission</div>
        <div className="text-sm text-muted" data-testid="reminders-permission-state">
          {permissionLabel(perm, native)}
        </div>
        {!native && <div className="text-sm text-muted">Reminders are set up on the phone only.</div>}
        {canAskForPermission(perm, native) && (
          <Button size="md" variant="outline" className="mt-2" onClick={() => void allow()} data-testid="reminders-allow">
            Allow notifications
          </Button>
        )}
      </div>
    </Card>
  );
}

function TimeRow({ group, value, onChange, testId }: { group: string; value: string; onChange: (time: string) => void; testId: string }) {
  return (
    <label className="flex min-h-14 items-center gap-3 py-1">
      <span className="min-w-0 flex-1 font-semibold">Time</span>
      <input
        type="time"
        value={value}
        onChange={(e) => {
          // A half-typed time reads as empty; only a whole one is a change.
          if (e.target.value) onChange(e.target.value);
        }}
        aria-label={`${group} reminder time`}
        data-testid={testId}
        className="num h-12 w-32 rounded-xl border border-line bg-surface-2 px-3 text-base font-semibold outline-none focus:border-accent"
      />
    </label>
  );
}
