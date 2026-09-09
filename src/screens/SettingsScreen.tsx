import { useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { backupFilename, csvFilename, deliverFile, exportBackup, exportBodyweightCsv, exportCsv, isBackup, type Backup } from '@/db/backup';
import { parseHevyCsv, reconcileWeights, type HevyParsed, type WeightReconcileRow } from '@/db/hevy';
import { resetToSeed, saveSettings, wipeAll } from '@/db/repo';
import { applyRestDefaults, dataCounts } from '@/db/settingsQueries';
import { DB_VERSION } from '@/db/db';
import { dateKeyToDate, toDateKey } from '@/domain/dates';
import { fmtNum } from '@/domain/format';
import { calorieTargetOn } from '@/domain/nutrition';
import type { Settings } from '@/domain/types';
import { notificationPermission, requestNotifications } from '@/state/notify';
import { Button } from '@/ui/components/Button';
import { Card, Divider, Row, SectionTitle, Stat } from '@/ui/components/Card';
import { Segmented, Toggle } from '@/ui/components/Chip';
import { NumberInput } from '@/ui/components/NumberField';
import { Confirm } from '@/ui/components/Sheet';
import { toast } from '@/ui/components/Toast';
import { ChevronIcon, TopBar } from '@/ui/components/TopBar';
import { HevyImportSheet, ReconcileSheet } from '@/ui/HevyImportSheet';
import { RestoreSheet } from '@/ui/RestoreSheet';
import { applyTheme } from '@/ui/theme';
import { useSettings } from '@/ui/hooks';

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
            <TargetsCard key={settings.savedAt ?? 'initial'} settings={settings} />

            <SectionTitle>Rest timer</SectionTitle>
            <RestCard key={settings.savedAt ?? 'initial'} settings={settings} />

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

            <SectionTitle>Check-in</SectionTitle>
            <Card>
              <Row title="Fortnightly check-in" subtitle="Current lifts, bodyweight trend, niggles" onClick={() => nav('/checkin')} right={<ChevronIcon />} />
            </Card>

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

function TargetsCard({ settings }: { settings: Settings }) {
  const [draft, setDraft] = useState<Record<TargetKey, number | null>>(() => Object.fromEntries(TARGET_FIELDS.map((f) => [f.key, settings[f.key]])) as Record<TargetKey, number | null>);
  const [startDate, setStartDate] = useState(settings.calorieStartDate ?? '');
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
            <NumberInput value={draft[f.key]} mode={f.mode} onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))} />
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

function RestCard({ settings }: { settings: Settings }) {
  const [compound, setCompound] = useState<number | null>(settings.restCompoundSec);
  const [isolation, setIsolation] = useState<number | null>(settings.restIsolationSec);
  const [carry, setCarry] = useState<number | null>(settings.restCarrySec);
  const [applyOpen, setApplyOpen] = useState(false);
  const [perm, setPerm] = useState(() => notificationPermission());

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
    <Card className="p-4">
      <div className="grid grid-cols-3 gap-3">
        <Field label="Compound (s)">
          <NumberInput value={compound} mode="numeric" min={5} max={900} onChange={setCompound} />
        </Field>
        <Field label="Isolation (s)">
          <NumberInput value={isolation} mode="numeric" min={5} max={900} onChange={setIsolation} />
        </Field>
        <Field label="Carry (s)">
          <NumberInput value={carry} mode="numeric" min={5} max={900} onChange={setCarry} />
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
        body="Everything is replaced with the seed routines."
        confirmLabel="Reset"
        danger
        onCancel={() => setResetOpen(false)}
        onConfirm={run(resetToSeed)}
      />
      <Confirm
        open={wipeOpen}
        title="Wipe all data?"
        body="Every routine, exercise, session and reading is deleted."
        confirmLabel="Wipe"
        danger
        onCancel={() => setWipeOpen(false)}
        onConfirm={run(wipeAll)}
      />
    </Card>
  );
}
