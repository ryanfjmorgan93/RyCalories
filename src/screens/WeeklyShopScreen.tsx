import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { loadShop, setShopFood, setShopLine, setShopPacks } from '@/db/shopQueries';
import { fmtNum } from '@/domain/format';
import { AISLES, fmtWeekRange, fmtWeight, lineFigures, moreOfTheSame, packText, weekText, type Aisle, type ShopLine } from '@/domain/weeklyShop';
import { Button } from '@/ui/components/Button';
import { Card, EmptyState } from '@/ui/components/Card';
import { Chip, Segmented, Toggle } from '@/ui/components/Chip';
import { TargetBar } from '@/ui/components/MacroBar';
import { NumberInput } from '@/ui/components/NumberField';
import { Sheet } from '@/ui/components/Sheet';
import { CheckIcon, TopBar } from '@/ui/components/TopBar';
import { useSettings, useToday } from '@/ui/hooks';

/**
 * The weekly shop (docs/superpowers/specs/2026-11-17-weekly-shop-design.md): the week's targets and
 * what the list reaches, then the list two ways: Plan (what will be eaten, the packs, − and +) and
 * In the shop (by aisle, a tick per line). A tap on a food's name fixes its pack, its aisle, or
 * marks it in already.
 */
export function WeeklyShopScreen() {
  const settings = useSettings();
  const today = useToday();
  const shop = useLiveQuery(() => (settings ? loadShop(today, settings) : undefined), [today, settings]);
  const [tab, setTab] = useState<'plan' | 'shop'>('plan');
  const [editing, setEditing] = useState<ShopLine | null>(null);

  return (
    <div>
      <TopBar title="Weekly shop" subtitle={shop ? fmtWeekRange(shop.week) : undefined} back="/food" />
      <div className="px-4">
        {shop === undefined && <div className="py-8 text-center text-sm text-muted">Loading…</div>}
        {shop && shop.lines.length === 0 && <EmptyState>No food from a label, a barcode, the UK table or your own figures in the last 4 weeks.</EmptyState>}
        {shop && shop.lines.length > 0 && (
          <>
            <Summary targets={shop.targets} totals={shop.totals} />
            {shop.totals.protein < shop.targets.protein && (
              <Button
                size="md"
                variant="secondary"
                full
                className="mt-3 text-[15px] font-medium"
                data-testid="shop-more"
                onClick={() => void setShopPacks(shop.week, moreOfTheSame(shop.lines, shop.targets.protein))}
              >
                More of the same
              </Button>
            )}

            <Segmented
              tabs
              className="mt-8"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'plan', label: 'Plan', testId: 'shop-tab-plan' },
                { value: 'shop', label: 'In the shop', testId: 'shop-tab-shop' },
              ]}
            />
            {tab === 'plan' ? <Plan week={shop.week} lines={shop.lines} onEdit={setEditing} /> : <InTheShop week={shop.week} lines={shop.lines} />}
            <div className="h-6" />
          </>
        )}
      </div>
      {shop && <FoodSheet week={shop.week} line={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** The week said first, in the serif, then the two bars and what is short or over. */
function Summary({ targets, totals }: { targets: { kcal: number | null; protein: number }; totals: { kcal: number; protein: number } }) {
  const gaps = [
    totals.protein !== targets.protein && `${fmtNum(Math.abs(targets.protein - totals.protein))} g protein ${totals.protein < targets.protein ? 'short' : 'over'}`,
    targets.kcal !== null && totals.kcal !== targets.kcal && `${fmtNum(Math.abs(targets.kcal - totals.kcal))} kcal ${totals.kcal < targets.kcal ? 'short' : 'over'}`,
  ].filter(Boolean);
  return (
    <>
      <div className="serif pb-5 pt-2 text-[2rem]" data-testid="shop-sentence">
        <p>
          Your week:{' '}
          {targets.kcal !== null && (
            <>
              <span className="num">{fmtNum(targets.kcal)}</span> kcal and{' '}
            </>
          )}
          <span className="num">{fmtNum(targets.protein)}</span>&nbsp;g protein.
        </p>
        <p className="serif-quiet">
          This list reaches {targets.kcal !== null && <span className="num">{fmtNum(totals.kcal)} and </span>}
          <span className="num">{fmtNum(totals.protein)}</span>.
        </p>
      </div>
      <Card framed className="space-y-4 px-5 py-5">
        <TargetBar label="Calories" value={totals.kcal} target={targets.kcal} unit="kcal" testId="shop-kcal" />
        <TargetBar label="Protein" value={totals.protein} target={targets.protein} unit="g" testId="shop-protein" />
        {gaps.length > 0 && (
          <div className="num border-t border-line pt-4 text-[13px]" data-testid="shop-gap">
            {gaps.join(' and ')}
          </div>
        )}
      </Card>
    </>
  );
}

/** Each food: what will be eaten this week and its protein, then the packs with − and +. */
function Plan({ week, lines, onEdit }: { week: string; lines: ShopLine[]; onEdit: (l: ShopLine) => void }) {
  return (
    <Card framed className="mt-4 divide-y divide-line/70">
      {lines.map((l) => (
        <div key={l.key} className="flex min-h-16 items-center gap-2 py-2 pl-4 pr-2" data-testid="shop-line">
          <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onEdit(l)}>
            <span className="block break-words text-[15px] leading-snug">{l.name}</span>
            <span className="num block text-xs text-muted">
              {weekText(l)} · {fmtNum(lineFigures(l).protein)} g protein{l.inAlready ? ' · in already' : ''}
            </span>
          </button>
          <div className="flex shrink-0 items-center">
            <Step label={`Fewer ${l.name}`} disabled={l.packs === 0} onClick={() => void setShopLine(week, l.key, { packs: l.packs - 1 })}>
              −
            </Step>
            <span className="num min-w-[4.75rem] text-center text-sm" data-testid="shop-packs">
              {packText(l)}
            </span>
            <Step label={`More ${l.name}`} onClick={() => void setShopLine(week, l.key, { packs: l.packs + 1 })}>
              +
            </Step>
          </div>
        </div>
      ))}
    </Card>
  );
}

function Step({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: string }) {
  return (
    <button type="button" aria-label={label} disabled={disabled} onClick={onClick} className="flex h-11 w-11 items-center justify-center rounded-full text-lg text-muted active:bg-fg/[0.06] disabled:opacity-30">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2">{children}</span>
    </button>
  );
}

/** The list by aisle, one big tick a line; what is in already at the bottom. Nothing here changes the plan. */
function InTheShop({ week, lines }: { week: string; lines: ShopLine[] }) {
  const toBuy = lines.filter((l) => l.packs > 0 && !l.inAlready);
  const inAlready = lines.filter((l) => l.inAlready);
  return (
    <div className="mt-4">
      <div className="num text-[13px] text-muted" data-testid="shop-trolley">
        {toBuy.filter((l) => l.ticked).length} of {toBuy.length} in the trolley
      </div>
      {AISLES.map((aisle) => {
        const here = toBuy.filter((l) => l.aisle === aisle);
        if (here.length === 0) return null;
        return (
          <section key={aisle} data-testid={`aisle-${aisle}`}>
            <h2 className="cap pb-2.5 pt-6">{aisle}</h2>
            <Card framed className="divide-y divide-line/70">
              {here.map((l) => (
                <button
                  key={l.key}
                  type="button"
                  role="checkbox"
                  aria-checked={l.ticked}
                  onClick={() => void setShopLine(week, l.key, { ticked: !l.ticked })}
                  className="flex min-h-14 w-full items-center gap-3.5 px-4 text-left active:bg-fg/[0.04]"
                  data-testid="shop-item"
                >
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-[1.5px] ${l.ticked ? 'border-accent bg-accent text-accent-fg' : 'border-fg/35'}`}>
                    {l.ticked && <CheckIcon size={15} />}
                  </span>
                  <span className={`min-w-0 flex-1 break-words text-[15px] ${l.ticked ? 'text-dim line-through decoration-fg/25' : ''}`}>{l.name}</span>
                  <span className={`num shrink-0 text-sm ${l.ticked ? 'text-dim' : 'text-muted'}`}>{packText(l)}</span>
                </button>
              ))}
            </Card>
          </section>
        );
      })}
      {inAlready.length > 0 && (
        <section data-testid="shop-in-already-list">
          <div className="flex items-baseline justify-between pb-2 pt-6">
            <h2 className="cap">In already</h2>
            <span className="num text-xs text-muted">{inAlready.length}</span>
          </div>
          <div className="text-[13px] text-muted">{inAlready.map((l) => l.name).join(', ')}</div>
        </section>
      )}
    </div>
  );
}

/** One food's fixes: in already this week; its pack and its aisle, for every week after. */
function FoodSheet({ week, line, onClose }: { week: string; line: ShopLine | null; onClose: () => void }) {
  const [pack, setPack] = useState<number | null>(null);
  const unit = line?.unit === 'portion' ? 'portions' : 'g';
  return (
    <Sheet open={line !== null} onClose={onClose} title={line?.name}>
      {line && (
        <div className="space-y-5">
          <Toggle
            checked={line.inAlready}
            onChange={(inAlready) => void setShopLine(week, line.key, { inAlready })}
            label="In already"
            sub="Still counted in the week, not bought."
            testId="shop-in-already"
          />
          <div>
            <div className="label pb-2">One pack, in {unit}</div>
            <div className="flex gap-2">
              <NumberInput value={pack} onChange={setPack} placeholder={line.unit === 'g' ? String(Math.round(line.pack)) : String(line.pack)} min={1} testId="shop-pack" />
              <Button
                variant="primary"
                disabled={pack === null || pack <= 0}
                onClick={() => {
                  if (pack === null || pack <= 0) return;
                  void setShopFood(line.key, { pack });
                  setPack(null);
                  onClose();
                }}
              >
                Save
              </Button>
            </div>
            {line.unit === 'g' && <div className="num mt-1.5 text-xs text-muted">Now {fmtWeight(line.pack)}</div>}
          </div>
          <div>
            <div className="label pb-2">Aisle</div>
            <div className="flex flex-wrap gap-2">
              {AISLES.map((a: Aisle) => (
                <Chip key={a} active={a === line.aisle} onClick={() => void setShopFood(line.key, { aisle: a }).then(onClose)} testId={`shop-aisle-${a}`}>
                  {a}
                </Chip>
              ))}
            </div>
          </div>
        </div>
      )}
    </Sheet>
  );
}
