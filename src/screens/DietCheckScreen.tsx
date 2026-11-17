import { useState } from 'react';
import { ClaudeError } from '@/ai/client';
import { checkDiet } from '@/ai/dietCheck';
import { fmtDateKey, isoToDateKey } from '@/domain/dates';
import { DIET_WINDOW_DAYS, dietScore, PART_MAX, VERDICT_LABEL, type DietAdvice, type DietCheck, type DietRegular, type Verdict } from '@/domain/dietCheck';
import { plural } from '@/domain/format';
import { openCoach } from '@/state/coachSheet';
import { Button } from '@/ui/components/Button';
import { Card, SectionTitle } from '@/ui/components/Card';
import { Sheet } from '@/ui/components/Sheet';
import { ArrowIcon, ChevronIcon, TopBar } from '@/ui/components/TopBar';
import { Hex } from '@/ui/GameMarks';
import { useSettings } from '@/ui/hooks';

const VERDICT_TONE: Record<Verdict, string> = {
  keep: 'bg-accent/15 text-accent',
  fine: 'bg-fg/[0.08] text-fg',
  swap: 'bg-warn/15 text-warn',
  cut: 'bg-warn/15 text-warn',
};

export function VerdictChip({ verdict }: { verdict: Verdict }) {
  return (
    <span className={`inline-flex h-[26px] shrink-0 items-center rounded-full px-2.5 text-[11px] font-medium uppercase tracking-[0.08em] ${VERDICT_TONE[verdict]}`} data-testid="diet-verdict">
      {VERDICT_LABEL[verdict]}
    </span>
  );
}

/**
 * The diet check (docs/superpowers/specs/2026-11-17-diet-check-design.md): the coach's reading of
 * the last 4 weeks of food, asked for on a tap and kept until the next one. The score and its four
 * parts, what is working, what to add and cut back, and the foods eaten most, each with a verdict
 * and, on a tap, what it does for the owner's body fat.
 */
export function DietCheckScreen() {
  const settings = useSettings();
  const check = settings?.dietCheck;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [food, setFood] = useState<DietRegular | null>(null);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await checkDiet();
    } catch (e) {
      setError(e instanceof ClaudeError ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <TopBar title="Diet check" subtitle={check ? `${check.loggedDays} of ${DIET_WINDOW_DAYS} days logged` : undefined} back="/food" />
      <div className="px-4">
        {settings && !check && (
          <div className="serif pb-6 pt-3 text-[2rem]">
            <p>What your food is doing for your goal.</p>
            <p className="serif-quiet">The coach reads your last 4 weeks and scores the food itself, not the calories.</p>
          </div>
        )}
        {check && <Result check={check} onFood={setFood} />}
        {settings && (
          <>
            {error && (
              <div role="alert" className="pb-3 text-sm text-warn" data-testid="diet-error">
                {error}
              </div>
            )}
            <Button size="lg" variant={check ? 'secondary' : 'primary'} full icon={check ? undefined : <ArrowIcon />} disabled={busy} onClick={() => void run()} data-testid="diet-run">
              {busy ? 'Reading your last 4 weeks…' : check ? 'Check again' : 'Check my diet'}
            </Button>
            <div className="pb-8 pt-2.5 text-center text-xs text-muted">A few pence of your Claude spend, only when you tap.</div>
          </>
        )}
      </div>
      <FoodSheet food={food} onClose={() => setFood(null)} />
    </div>
  );
}

function Result({ check, onFood }: { check: DietCheck; onFood: (r: DietRegular) => void }) {
  return (
    <div data-testid="diet-result">
      <div className="flex items-center gap-4 pt-3">
        <Hex size="lg">
          <span className="num text-[42px] font-light leading-none" data-testid="diet-score">
            {dietScore(check)}
          </span>
          <span className="mt-1 text-[10px] tracking-[0.12em] text-muted">OF 100 ≈</span>
        </Hex>
        <div className="min-w-0 text-[13px] text-muted">
          <div>The coach's reading of your diary</div>
          <div className="num mt-0.5">Checked {fmtDateKey(isoToDateKey(check.at))}</div>
        </div>
      </div>
      <div className="serif pb-5 pt-5 text-[1.875rem]">
        <p data-testid="diet-headline">{check.headline}</p>
        {check.detail && <p className="serif-quiet">{check.detail}</p>}
      </div>

      <Card framed className="space-y-4 px-5 py-5">
        {check.parts.map((p) => (
          <div key={p.key} data-testid={`diet-part-${p.key}`}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[13px] text-muted">{p.name}</span>
              <span className="num text-[13px]">
                {p.points} <span className="text-muted">of {PART_MAX}</span>
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-fg/[0.07]">
              <div className="h-full rounded-full bg-accent" style={{ width: `${(p.points / PART_MAX) * 100}%` }} />
            </div>
            <div className="mt-2 text-xs leading-snug text-muted">{p.line}</div>
          </div>
        ))}
      </Card>

      {check.working.length > 0 && (
        <>
          <SectionTitle>What is working</SectionTitle>
          <Card framed className="divide-y divide-line/70" data-testid="diet-working">
            {check.working.map((w) => (
              <div key={w} className="px-5 py-3.5 text-[15px] leading-snug">
                {w}
              </div>
            ))}
          </Card>
        </>
      )}
      <AdviceList title="Add" items={check.add} testId="diet-add" />
      <AdviceList title="Cut back" items={check.cut} testId="diet-cut" />

      {check.regulars.length > 0 && (
        <>
          <SectionTitle right={<span className="text-[13px] text-muted">Last 4 weeks</span>}>Your regulars</SectionTitle>
          <Card framed className="divide-y divide-line/70" data-testid="diet-regulars">
            {check.regulars.map((r) => (
              <button key={r.name} type="button" onClick={() => onFood(r)} className="flex min-h-16 w-full items-center gap-3 px-5 py-3 text-left active:bg-fg/[0.04]" data-testid="diet-regular">
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-base leading-snug">{r.name}</span>
                  <span className="num block text-xs text-muted">{plural(r.times, 'time')}</span>
                </span>
                <VerdictChip verdict={r.verdict} />
                <ChevronIcon className="shrink-0" />
              </button>
            ))}
          </Card>
        </>
      )}
      <div className="h-8" />
    </div>
  );
}

function AdviceList({ title, items, testId }: { title: string; items: DietAdvice[]; testId: string }) {
  if (items.length === 0) return null;
  return (
    <>
      <SectionTitle>{title}</SectionTitle>
      <Card framed className="divide-y divide-line/70" data-testid={testId}>
        {items.map((a) => (
          <div key={a.what} className="px-5 py-3.5">
            <div className="text-base leading-snug">{a.what}</div>
            {a.why && <div className="mt-1 text-[13px] leading-snug text-muted">{a.why}</div>}
          </div>
        ))}
      </Card>
    </>
  );
}

/** One food, straight: what it does for the owner's body fat, what is against it, and a better option. */
function FoodSheet({ food, onClose }: { food: DietRegular | null; onClose: () => void }) {
  return (
    <Sheet open={food !== null} onClose={onClose} title={food?.name}>
      {food && (
        <div className="space-y-5 pb-2" data-testid="diet-food">
          <div className="flex items-center justify-between gap-3">
            <span className="num text-[13px] text-muted">
              {plural(food.times, 'time')} on {plural(food.days, 'day')} in 4 weeks
            </span>
            <VerdictChip verdict={food.verdict} />
          </div>
          <Block title="For your body fat" text={food.bodyFat} />
          <Block title="The catch" text={food.theCatch} />
          <Block title="Better, if you want it" text={food.better} />
          <Button
            size="lg"
            variant="primary"
            full
            icon={<ArrowIcon />}
            data-testid="diet-ask"
            onClick={() => {
              onClose();
              openCoach(`Tell me more about ${food.name} for my goal.`);
            }}
          >
            Ask the coach about this
          </Button>
        </div>
      )}
    </Sheet>
  );
}

function Block({ title, text }: { title: string; text: string }) {
  if (!text) return null;
  return (
    <div>
      <h3 className="cap">{title}</h3>
      <p className="mt-2 text-[15px] leading-relaxed">{text}</p>
    </div>
  );
}
