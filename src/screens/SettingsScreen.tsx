import { useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { backupFilename, csvFilename, deliverFile, exportBackup, exportBodyweightCsv, exportCsv, isBackup, type Backup } from '@/db/backup';
import { parseHevyCsv, reconcileWeights, type HevyParsed, type WeightReconcileRow } from '@/db/hevy';
import { resetToSeed, saveSettings, wipeAll } from '@/db/repo';
import { applyRestDefaults, dataCounts } from '@/db/settingsQueries';
import { clearProductCache } from '@/db/productRepo';
import { DB_VERSION } from '@/db/db';
import { dateKeyToDate, toDateKey } from '@/domain/dates';
import { fmtNum } from '@/domain/format';
import { calorieTargetOn } from '@/domain/nutrition';
import { MUSCLE_GROUPS, type MuscleGroup, type Settings } from '@/domain/types';
import { notificationPermission, requestNotifications } from '@/state/notify';
import { AboutCard } from '@/ui/AboutCard';
import { AssistantSettingsCard } from '@/ui/AssistantSettingsCard';
import { Button } from '@/ui/components/Button';
import { Card, Divider, Row, SectionTitle, Stat } from '@/ui/components/Card';
import { Chip, Segmented, Toggle } from '@/ui/components/Chip';
import { NumberField, NumberInput } from '@/ui/components/NumberField';
import { Confirm } from '@/ui/components/Sheet';
import { toast } from '@/ui/components/Toast';
import { ChevronIcon, TopBar } from '@/ui/components/TopBar';
import { HevyImportSheet, ReconcileSheet } from '@/ui/HevyImportSheet';
import { RestoreSheet } from '@/ui/RestoreSheet';
import { applyTheme } from '@/ui/theme';
import { useSettings } from '@/ui/hooks';

const PLATE_SIZES = [25, 20, 15, 10, 5, 2.5, 1.25, 0.5];

// ---------------------------------------------------------------------------
// Draft reseeding
//
// This screen mixes drafted cards (their own Save button) with instant-save controls elsewhere
// on the same screen (toggles, plate chips, the theme and effort-scale segmented controls). Every
// write goes through `saveSettings`, which bumps `settings.savedAt` regardless of which fields it
// touched — so reseeding a card whenever `settings` changes at all reverts a half-typed draft the
// moment the user flips an unrelated toggle. A card must reseed only when the SAVED values of the
// fields it owns have actually changed from the snapshot it last seeded from; its own Save (which
// changes its owned values to the draft values) then reseeds harmlessly.

function pick<K extends keyof Settings>(settings: Settings, keys: readonly K[]): Pick<Settings, K> {
  const out = {} as Pick<Settings, K>;
  for (const k of keys) out[k] = settings[k];
  return out;
}

/**
 * Value equality one level into arrays and plain objects — enough for the settings fields the
 * cards below own (number/string scalars, a `number[]` of plates, a muscle-group → number map).
 * A plain `===` on those would never match: Dexie round-trips every saved row through IndexedDB,
 * so even an untouched array or object field comes back as a new reference on every reload.
 */
function valuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ak = Object.keys(a as object);
    const bk = Object.keys(b as object);
    return ak.length === bk.length && ak.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

/**
 * Reseeds a card's drafts only when the saved values of `ownedKeys` differ from the snapshot this
 * hook last seeded from. `reseed` should copy the current `settings` prop into the card's own
 * draft state; it takes no argument because it always runs against the `settings` this render saw.
 *
 * Calls `setState` directly during render rather than in an effect — a deliberate choice already
 * used on this screen: a `key`-driven remount here once left two copies of a card briefly in the
 * DOM, which this pattern does not risk.
 */
function useOwnedReseed<K extends keyof Settings>(settings: Settings, ownedKeys: readonly K[], reseed: () => void): void {
  const [seeded, setSeeded] = useState<Pick<Settings, K>>(() => pick(settings, ownedKeys));
  const owned = pick(settings, ownedKeys);
  if (!ownedKeys.every((k) => valuesEqual(owned[k], seeded[k]))) {
    setSeeded(owned);
    reseed();
  }
}

export function SettingsScreen() {
  const nav = useNavigate();
  const settings = useSettings();

  return (
    <div>
      <TopBar title="Settings" />
      <div className="px-4">
        <SectionTitle>Data</SectionTitle>
        <DataCard />

        {!settings && <div className="py-8 text-muted">Loading…</div>}
        {settings && (
          <>
            <SectionTitle>Targets</SectionTitle>
            <TargetsCard settings={settings} />

            <SectionTitle>Logging</SectionTitle>
            <Card className="p-4">
              <div className="mb-1 px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Effort scale</div>
              <Segmented
                value={settings.effortScale ?? 'rir'}
                options={[
                  { value: 'rir', label: 'RIR' },
                  { value: 'rpe', label: 'RPE' },
                ]}
                onChange={async (effortScale) => {
                  await saveSettings({ effortScale });
                }}
              />
              <div className="mt-2 text-sm text-muted">RPE is 10 minus RIR. Stored as RIR either way.</div>
            </Card>

            <SectionTitle>Rest timer</SectionTitle>
            <RestCard settings={settings} />

            <SectionTitle>Appearance</SectionTitle>
            <Card className="p-4">
              <Segmented
                value={settings.theme}
                options={[
                  { value: 'dark', label: 'Dark' },
                  { value: 'light', label: 'Light' },
                ]}
                onChange={async (theme) => {
                  applyTheme(theme);
                  await saveSettings({ theme });
                }}
              />
            </Card>

            <SectionTitle>Food lookup</SectionTitle>
            <Card className="px-4">
              <Toggle
                checked={settings.productLookup !== false}
                onChange={async (productLookup) => {
                  await saveSettings({ productLookup });
                  if (!productLookup) {
                    const n = await clearProductCache();
                    toast(n ? `Off. ${n} cached ${n === 1 ? 'product' : 'products'} deleted.` : 'Off.');
                  }
                }}
                label="Look up labels online"
                sub="See About for everything that leaves the device."
              />
            </Card>

            <SectionTitle>Check-in</SectionTitle>
            <Card>
              <Row title="Fortnightly check-in" subtitle="Current lifts, bodyweight trend, niggles" onClick={() => nav('/checkin')} right={<ChevronIcon />} />
            </Card>

            <SectionTitle>Plates</SectionTitle>
            <PlatesCard settings={settings} />

            <SectionTitle>Progression</SectionTitle>
            <ProgressionCard settings={settings} />

            <SectionTitle>Assistant</SectionTitle>
            <AssistantSettingsCard />

            <SectionTitle>About</SectionTitle>
            <AboutCard />

            <SectionTitle>Developer</SectionTitle>
            <DeveloperCard />
          </>
        )}
        <div className="h-6" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Data

function DataCard() {
  const restoreInput = useRef<HTMLInputElement>(null);
  const hevyInput = useRef<HTMLInputElement>(null);
  const [backup, setBackup] = useState<Backup | null>(null);
  const [parsed, setParsed] = useState<HevyParsed | null>(null);
  const [reconcileRows, setReconcileRows] = useState<WeightReconcileRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  const deliver = async (name: string, text: string, mime: string) => {
    const how = await deliverFile(name, text, mime);
    if (how !== 'cancelled') toast(how === 'shared' ? 'Shared' : 'Downloaded', 'ok');
  };

  const guarded = (fn: () => Promise<void>) => async () => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch {
      toast('Something went wrong', 'danger');
    } finally {
      setBusy(false);
    }
  };

  const onRestoreFile = async (file: File | undefined) => {
    if (!file) return;
    let data: unknown;
    try {
      data = JSON.parse((await file.text()).replace(/^\uFEFF/, ''));
    } catch {
      data = null;
    }
    if (!isBackup(data)) {
      toast('Not an Iron backup', 'danger');
      return;
    }
    setBackup(data);
  };

  const onHevyFile = async (file: File | undefined) => {
    if (!file) return;
    const p = parseHevyCsv(await file.text());
    if (p.kind === 'unknown') {
      toast(p.warnings[0] ?? 'Not a Hevy export', 'danger');
      return;
    }
    setParsed(p);
  };

  const reconcile = guarded(async () => {
    const rows = await reconcileWeights();
    if (rows.length === 0) {
      toast('Weights already match');
      return;
    }
    setReconcileRows(rows);
  });

  return (
    <Card className="grid gap-2 p-4">
      <Button full disabled={busy} onClick={guarded(async () => deliver(backupFilename(), JSON.stringify(await exportBackup(), null, 2), 'application/json'))}>
        Export JSON backup
      </Button>
      <Button full disabled={busy} onClick={guarded(async () => deliver(csvFilename(), await exportCsv(), 'text/csv'))}>
        Export sets CSV
      </Button>
      <Button full disabled={busy} onClick={guarded(async () => deliver('iron-bodyweight.csv', await exportBodyweightCsv(), 'text/csv'))}>
        Export bodyweight CSV
      </Button>
      <Button full disabled={busy} onClick={() => restoreInput.current?.click()}>
        Restore JSON backup
      </Button>
      <Button full variant="primary" disabled={busy} onClick={() => hevyInput.current?.click()}>
        Import Hevy CSV
      </Button>
      <Button full variant="outline" disabled={busy} onClick={() => void reconcile()}>
        Reconcile weights with history
      </Button>

      <input
        ref={restoreInput}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          void onRestoreFile(f);
        }}
      />
      <input
        ref={hevyInput}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          void onHevyFile(f);
        }}
      />

      <RestoreSheet backup={backup} open={backup !== null} onClose={() => setBackup(null)} />
      {parsed && <HevyImportSheet parsed={parsed} open onClose={() => setParsed(null)} onDone={() => setParsed(null)} />}
      {reconcileRows && <ReconcileSheet rows={reconcileRows} open onClose={() => setReconcileRows(null)} />}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Targets

type TargetKey =
  | 'calorieStart'
  | 'calorieStep'
  | 'calorieStepDays'
  | 'calorieCeiling'
  | 'proteinTarget'
  | 'proteinTargetLegDay'
  | 'weeklyGainTargetMin'
  | 'weeklyGainTargetMax'
  | 'bodyweightTargetMin'
  | 'bodyweightTargetMax';

const TARGET_FIELDS: { key: TargetKey; label: string; mode?: 'numeric' }[] = [
  { key: 'calorieStart', label: 'Calories start', mode: 'numeric' },
  { key: 'calorieStep', label: 'Step (kcal)', mode: 'numeric' },
  { key: 'calorieStepDays', label: 'Step every (days)', mode: 'numeric' },
  { key: 'calorieCeiling', label: 'Calorie ceiling', mode: 'numeric' },
  { key: 'proteinTarget', label: 'Protein (g)', mode: 'numeric' },
  { key: 'proteinTargetLegDay', label: 'Protein leg day (g)', mode: 'numeric' },
  { key: 'weeklyGainTargetMin', label: 'Weekly gain min (kg)' },
  { key: 'weeklyGainTargetMax', label: 'Weekly gain max (kg)' },
  { key: 'bodyweightTargetMin', label: 'Bodyweight min (kg)' },
  { key: 'bodyweightTargetMax', label: 'Bodyweight max (kg)' },
];

function fmtKey(key: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(dateKeyToDate(key));
}

function draftFromTargets(settings: Settings): Record<TargetKey, number | null> {
  return Object.fromEntries(TARGET_FIELDS.map((f) => [f.key, settings[f.key]])) as Record<TargetKey, number | null>;
}

const TARGETS_OWNED_KEYS: (keyof Settings)[] = [...TARGET_FIELDS.map((f) => f.key), 'calorieStartDate'];

function TargetsCard({ settings }: { settings: Settings }) {
  const [draft, setDraft] = useState<Record<TargetKey, number | null>>(() => draftFromTargets(settings));
  const [startDate, setStartDate] = useState(settings.calorieStartDate ?? '');
  useOwnedReseed(settings, TARGETS_OWNED_KEYS, () => {
    setDraft(draftFromTargets(settings));
    setStartDate(settings.calorieStartDate ?? '');
  });
  const today = calorieTargetOn(toDateKey(), settings);

  const save = async () => {
    const patch: Partial<Settings> = {};
    for (const f of TARGET_FIELDS) {
      const v = draft[f.key];
      if (v !== null) patch[f.key] = v;
    }
    if (startDate) patch.calorieStartDate = startDate;
    await saveSettings(patch);
    toast('Saved', 'ok');
  };

  return (
    <Card className="p-4">
      <div className="flex items-end gap-6">
        <Stat label="Today" value={today ? `${fmtNum(today.kcal)} kcal` : '—'} sub={today ? (today.nextStepOn ? `next step on ${fmtKey(today.nextStepOn)}` : 'at ceiling') : 'starts when you first save'} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3">
        {TARGET_FIELDS.map((f) => (
          <Field key={f.key} label={f.label}>
            <NumberInput
              value={draft[f.key]}
              mode={f.mode}
              onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))}
              // A blanked field is dropped from the save patch (its old value is what stays), so a
              // box left empty at Save time would show "Saved" while quietly keeping the number it
              // had before. Refilling from the saved value on blur means the box can never lie
              // about what Save is about to do with it.
              onBlur={() => setDraft((d) => (d[f.key] === null ? { ...d, [f.key]: settings[f.key] } : d))}
              testId={`target-${f.key}`}
            />
          </Field>
        ))}
        <Field label="Reverse diet start">
          <input
            type="date"
            value={startDate}
            max={toDateKey()}
            onChange={(e) => setStartDate(e.target.value)}
            className="num h-12 w-full rounded-xl border border-line bg-surface-2 px-3 text-base font-bold outline-none focus:border-accent"
          />
        </Field>
      </div>
      <div className="mt-2 text-sm text-muted">
        {settings.calorieStartDate ? `Reverse diet start: ${fmtKey(settings.calorieStartDate)}` : 'Reverse diet start: starts when you first save'}
      </div>
      <Button variant="primary" full className="mt-4" onClick={() => void save()}>
        Save targets
      </Button>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <div className="mb-1 px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">{label}</div>
      {children}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Rest timer

const PERMISSION_LABEL: Record<ReturnType<typeof notificationPermission>, string> = {
  granted: 'Allowed',
  denied: 'Blocked in browser settings',
  default: 'Not asked yet',
  unsupported: 'Not supported here',
};

const REST_OWNED_KEYS: (keyof Settings)[] = ['restCompoundSec', 'restIsolationSec', 'restCarrySec'];

function RestCard({ settings }: { settings: Settings }) {
  const [compound, setCompound] = useState<number | null>(settings.restCompoundSec);
  const [isolation, setIsolation] = useState<number | null>(settings.restIsolationSec);
  const [carry, setCarry] = useState<number | null>(settings.restCarrySec);
  const [applyOpen, setApplyOpen] = useState(false);
  const [perm, setPerm] = useState(() => notificationPermission());
  useOwnedReseed(settings, REST_OWNED_KEYS, () => {
    setCompound(settings.restCompoundSec);
    setIsolation(settings.restIsolationSec);
    setCarry(settings.restCarrySec);
  });

  // The numbers on screen (falling back to what is saved); a rest under 5 s would fire the cue at once.
  const effective = () => ({
    restCompoundSec: Math.max(5, compound ?? settings.restCompoundSec),
    restIsolationSec: Math.max(5, isolation ?? settings.restIsolationSec),
    restCarrySec: Math.max(5, carry ?? settings.restCarrySec),
  });
  const save = async () => {
    await saveSettings(effective());
    toast('Saved', 'ok');
  };

  return (
    <Card className="p-4" data-testid="rest-card">
      <div className="grid grid-cols-3 gap-3">
        <Field label="Compound (s)">
          <NumberInput
            value={compound}
            mode="numeric"
            min={5}
            max={900}
            onChange={setCompound}
            onBlur={() => setCompound((v) => v ?? settings.restCompoundSec)}
            testId="rest-compound"
          />
        </Field>
        <Field label="Isolation (s)">
          <NumberInput
            value={isolation}
            mode="numeric"
            min={5}
            max={900}
            onChange={setIsolation}
            onBlur={() => setIsolation((v) => v ?? settings.restIsolationSec)}
            testId="rest-isolation"
          />
        </Field>
        <Field label="Carry (s)">
          <NumberInput
            value={carry}
            mode="numeric"
            min={5}
            max={900}
            onChange={setCarry}
            testId="rest-carry"
            onBlur={() => setCarry((v) => v ?? settings.restCarrySec)}
          />
        </Field>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Button variant="outline" onClick={() => setApplyOpen(true)}>
          Apply to every exercise
        </Button>
        <Button variant="primary" onClick={() => void save()}>
          Save
        </Button>
      </div>

      <div className="mt-3">
        <Divider />
        <Toggle
          label="Vibrate when rest ends"
          checked={settings.restVibrate}
          onChange={async (v) => {
            await saveSettings({ restVibrate: v });
            toast('Saved', 'ok');
          }}
        />
        <Divider />
        <Toggle
          label="Notify when rest ends"
          sub="Only when the app is in the background"
          checked={settings.restNotify}
          onChange={async (v) => {
            await saveSettings({ restNotify: v });
            toast('Saved', 'ok');
          }}
        />
        <Divider />
        <div className="flex min-h-14 items-center gap-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="font-semibold">Notification permission</div>
            <div className="text-sm text-muted">{PERMISSION_LABEL[perm]}</div>
          </div>
          {perm !== 'granted' && perm !== 'unsupported' && (
            <Button size="md" variant="outline" onClick={async () => setPerm(await requestNotifications())}>
              Allow notifications
            </Button>
          )}
        </div>
      </div>

      <Confirm
        open={applyOpen}
        title="Apply rest defaults to every exercise?"
        body={`Compound ${effective().restCompoundSec} s · isolation ${effective().restIsolationSec} s · carry ${effective().restCarrySec} s. Per-routine overrides are kept.`}
        confirmLabel="Apply"
        onCancel={() => setApplyOpen(false)}
        onConfirm={async () => {
          setApplyOpen(false);
          try {
            const values = effective();
            await saveSettings(values);
            const n = await applyRestDefaults({ ...settings, ...values });
            toast(`Updated ${n} ${n === 1 ? 'exercise' : 'exercises'}`, 'ok');
          } catch {
            toast('Could not apply', 'danger');
          }
        }}
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Plates

const PLATES_OWNED_KEYS: (keyof Settings)[] = ['barKg'];

function PlatesCard({ settings }: { settings: Settings }) {
  // `plates` has no separate draft — the chips are always the live saved list — so only `barKg`
  // needs reseeding.
  const plates = settings.plates ?? [25, 20, 15, 10, 5, 2.5, 1.25];
  const [barKg, setBarKg] = useState<number | null>(settings.barKg ?? 20);
  useOwnedReseed(settings, PLATES_OWNED_KEYS, () => {
    setBarKg(settings.barKg ?? 20);
  });

  const toggle = async (size: number) => {
    const next = plates.includes(size) ? plates.filter((p) => p !== size) : [...plates, size];
    await saveSettings({ plates: next });
  };

  return (
    <Card className="p-4" data-testid="plates-card">
      <NumberField
        label="Bar (kg)"
        value={barKg}
        onChange={(v) => {
          setBarKg(v);
          void saveSettings({ barKg: v ?? 20 });
        }}
        step={2.5}
        min={0}
        unit="kg"
        size="md"
        testId="plates-bar-kg"
      />
      <div className="mt-3 flex flex-wrap gap-2">
        {PLATE_SIZES.map((size) => (
          <Chip key={size} className="min-h-11" active={plates.includes(size)} onClick={() => void toggle(size)}>
            {fmtNum(size)} kg
          </Chip>
        ))}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Progression

function setTargetsFrom(settings: Settings): Record<MuscleGroup, number | null> {
  return Object.fromEntries(MUSCLE_GROUPS.map((g) => [g, settings.weeklySetTargets?.[g] ?? null])) as Record<MuscleGroup, number | null>;
}

const PROGRESSION_OWNED_KEYS: (keyof Settings)[] = ['deloadPercent', 'weeklySessionTarget', 'weeklySetTargets'];

function ProgressionCard({ settings }: { settings: Settings }) {
  const [deloadPercent, setDeloadPercent] = useState<number | null>(Math.round((settings.deloadPercent ?? 0.9) * 100));
  const [weeklyTarget, setWeeklyTarget] = useState<number | null>(settings.weeklySessionTarget ?? 3);
  const [setTargets, setSetTargets] = useState<Record<MuscleGroup, number | null>>(() => setTargetsFrom(settings));
  useOwnedReseed(settings, PROGRESSION_OWNED_KEYS, () => {
    setDeloadPercent(Math.round((settings.deloadPercent ?? 0.9) * 100));
    setWeeklyTarget(settings.weeklySessionTarget ?? 3);
    setSetTargets(setTargetsFrom(settings));
  });

  const save = async () => {
    const weeklySetTargets: Partial<Record<MuscleGroup, number>> = {};
    for (const g of MUSCLE_GROUPS) {
      const v = setTargets[g];
      if (v !== null) weeklySetTargets[g] = v;
    }
    await saveSettings({
      deloadPercent: Math.min(1, Math.max(0, (deloadPercent ?? 90) / 100)),
      weeklySessionTarget: weeklyTarget ?? 3,
      weeklySetTargets,
    });
    toast('Saved', 'ok');
  };

  return (
    <Card className="p-4" data-testid="progression-card">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Deload (%)">
          <NumberInput
            value={deloadPercent}
            onChange={setDeloadPercent}
            mode="numeric"
            min={0}
            max={100}
            placeholder="90"
            testId="deload-percent"
            onBlur={() => setDeloadPercent((v) => v ?? Math.round((settings.deloadPercent ?? 0.9) * 100))}
          />
        </Field>
        <Field label="Sessions per week">
          <NumberInput
            value={weeklyTarget}
            onChange={setWeeklyTarget}
            mode="numeric"
            min={1}
            placeholder="3"
            onBlur={() => setWeeklyTarget((v) => v ?? (settings.weeklySessionTarget ?? 3))}
          />
        </Field>
      </div>
      <Divider />
      <div className="mt-3 mb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Weekly set targets</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-3">
        {MUSCLE_GROUPS.filter((g) => g !== 'full body' && g !== 'other').map((g) => (
          <Field key={g} label={g}>
            <NumberInput
              value={setTargets[g]}
              onChange={(v) => setSetTargets((t) => ({ ...t, [g]: v }))}
              // Save rebuilds `weeklySetTargets` from every group's draft value and that whole map
              // replaces the saved one (no per-key merge) — so a blanked group here would not just
              // look wrong, it would permanently delete that group's target on Save. Refill it from
              // its own saved value (or null, if it never had one) so blank can never reach Save.
              onBlur={() => setSetTargets((t) => (t[g] === null ? { ...t, [g]: settings.weeklySetTargets?.[g] ?? null } : t))}
              mode="numeric"
              min={0}
              placeholder="none"
              testId={`set-target-${g}`}
            />
          </Field>
        ))}
      </div>
      <Button variant="primary" full className="mt-4" onClick={() => void save()}>
        Save
      </Button>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Developer

function DeveloperCard() {
  const counts = useLiveQuery(() => dataCounts(), []);
  const [resetOpen, setResetOpen] = useState(false);
  const [wipeOpen, setWipeOpen] = useState(false);
  const pending = useRef(false);
  const run = (fn: () => Promise<void>) => async () => {
    if (pending.current) return;
    pending.current = true;
    try {
      await fn();
      window.location.reload();
    } catch {
      pending.current = false;
      toast('Something went wrong', 'danger');
    }
  };

  return (
    <Card className="p-4">
      {/* Live row counts and the schema version the database is actually open at. This is the
          line to check on the phone after a version bump: the sandbox cannot prove a migration
          completed on a real WebView, only that it completed under fake-indexeddb. */}
      <div className="num text-sm text-muted" data-testid="data-counts">
        {counts
          ? `${counts.exercises} exercises · ${counts.routines} routines · ${counts.sessions} sessions · ${counts.sets} sets · ${counts.meals} meals`
          : 'Counting…'}
      </div>
      {counts && (
        <div className={`num mt-1 text-sm ${counts.behind ? 'text-danger' : 'text-dim'}`} data-testid="db-version">
          Database v{counts.dbVersion}
          {counts.behind ? ` — build expects v${DB_VERSION}` : ''}
        </div>
      )}
      <div className="mt-3 grid gap-2">
        <Button full variant="danger" onClick={() => setResetOpen(true)}>
          Reset to seed data
        </Button>
        <Button full variant="danger" onClick={() => setWipeOpen(true)}>
          Wipe all data
        </Button>
      </div>
      <div className="mt-3 text-xs text-dim">Iron {__APP_VERSION__}</div>

      <Confirm
        open={resetOpen}
        title="Reset to seed data?"
        body="Everything is replaced with the seed routines. Meals are deleted too."
        confirmLabel="Reset"
        danger
        onCancel={() => setResetOpen(false)}
        onConfirm={run(resetToSeed)}
      />
      <Confirm
        open={wipeOpen}
        title="Wipe all data?"
        body="Every routine, exercise, session, reading and meal is deleted."
        confirmLabel="Wipe"
        danger
        onCancel={() => setWipeOpen(false)}
        onConfirm={run(wipeAll)}
      />
    </Card>
  );
}
