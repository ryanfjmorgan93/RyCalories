import { useEffect, useState } from 'react';
import type { Settings } from '@/domain/types';
import { healthAccess, type HealthAccess } from '@/platform/health';
import { setHealthWeight } from '@/state/healthWeight';
import { isNative } from '@/state/native';
import { Card } from './components/Card';
import { Toggle } from './components/Chip';
import { toast } from './components/Toast';

/**
 * Settings → Health Connect: weight into the bodyweight log, read from Health Connect (where Samsung
 * Health puts a scale's or an InBody scan's weight). Turning it on asks Health Connect for weight and
 * reads the last 90 days at once. Steps are asked for from the Steps strip on Home.
 */
export function HealthConnectCard({ settings }: { settings: Settings }) {
  const native = isNative();
  const [access, setAccess] = useState<HealthAccess | 'loading'>(native ? 'loading' : 'unavailable');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!native) return;
    let live = true;
    void healthAccess('weight').then((a) => live && setAccess(a));
    return () => {
      live = false;
    };
  }, [native]);

  const on = settings.healthWeight === true;
  const unavailable = access === 'unavailable';
  const sub = unavailable
    ? native
      ? 'Health Connect is not available on this phone.'
      : 'Health Connect is on the phone.'
    : on
      ? 'On. Days you logged yourself keep your own reading.'
      : 'Reads your scale and InBody weight from Health Connect. Writes nothing.';

  const change = async (next: boolean) => {
    if (busy || (unavailable && next)) return;
    setBusy(true);
    try {
      const result = await setHealthWeight(next);
      if (result === 'needs-permission') toast('Health Connect did not allow weight', 'danger');
      else if (result === 'unavailable') toast('Health Connect is not available', 'danger');
      if (result !== 'off') setAccess(result);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="px-4" data-testid="health-connect">
      <Toggle checked={on} onChange={(v) => void change(v)} label="Weight into the bodyweight log" sub={sub} testId="health-weight" />
    </Card>
  );
}
