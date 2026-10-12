import { useState } from 'react';
import { logBodyweight } from '@/db/repo';
import { fmtDateKey } from '@/domain/dates';
import { fmtKg, fmtNum, fmtSignedKg } from '@/domain/format';
import type { Reading } from '@/domain/weighIn';
import { Button } from '@/ui/components/Button';
import { Card } from '@/ui/components/Card';
import { NumberInput } from '@/ui/components/NumberField';
import { toast } from '@/ui/components/Toast';

/**
 * The weekly weigh-in: from the start of the week until a weight is logged in it, one field and
 * one button, with last week's reading beside it. Home shows it only while `weighInDue`, so a
 * logged reading removes it (the live query that decides that is Home's own).
 *
 * The field starts empty and shows last week's figure as its placeholder: a stale number one tap
 * from being logged as today's would be worse than typing one.
 */
export function WeighInCard({ today, last }: { today: string; last: Reading | null }) {
  const [kg, setKg] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  // The floor BodyweightScreen applies to the same action: `logBodyweight` does not validate, and a
  // zero or negative reading would feed the trend the owner reverse-diets against.
  const valid = kg !== null && kg > 0;

  const log = async () => {
    if (saving || kg === null || kg <= 0) return;
    setSaving(true);
    try {
      await logBodyweight(today, kg);
      toast(last ? `Logged ${fmtKg(kg)} · ${fmtSignedKg(kg - last.kg)} since ${fmtDateKey(last.date)}` : `Logged ${fmtKg(kg)}`, 'ok');
      setKg(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="mt-3 p-4" data-testid="weigh-in-card">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Weigh-in</h2>
        {last && (
          <div className="num text-sm text-muted" data-testid="weigh-in-last">
            Last: {fmtKg(last.kg)} · {fmtDateKey(last.date)}
          </div>
        )}
      </div>
      <div className="mt-2 text-[15px]">{last ? "This week's weight isn't logged yet." : 'Log your weight to start the trend.'}</div>
      <div className="mt-3 flex gap-2">
        <NumberInput value={kg} onChange={setKg} placeholder={last ? fmtNum(last.kg) : 'kg'} testId="weigh-in-input" />
        <Button variant="primary" disabled={!valid || saving} onClick={() => void log()} data-testid="weigh-in-log">
          Log
        </Button>
      </div>
    </Card>
  );
}
