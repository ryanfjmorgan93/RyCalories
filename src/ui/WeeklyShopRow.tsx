import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { loadShop } from '@/db/shopQueries';
import { fmtNum } from '@/domain/format';
import { fmtWeekRange } from '@/domain/weeklyShop';
import { ChevronIcon } from './components/TopBar';
import { useSettings } from './hooks';

/**
 * The weekly shop's way in on Food (docs/superpowers/specs/2026-11-17-weekly-shop-design.md): how
 * many foods to buy and how far the list is from the week's protein. Nothing when the switch in
 * Settings is off or there is no food to build a list from.
 */
export function WeeklyShopRow({ today, className = '' }: { today: string; className?: string }) {
  const nav = useNavigate();
  const settings = useSettings();
  const shop = useLiveQuery(() => (settings && settings.weeklyShop !== false ? loadShop(today, settings) : undefined), [today, settings]);
  if (!settings || settings.weeklyShop === false || !shop || shop.lines.length === 0) return null;
  const toBuy = shop.lines.filter((l) => l.packs > 0 && !l.inAlready).length;
  const inAlready = shop.lines.filter((l) => l.inAlready).length;
  const short = shop.targets.protein - shop.totals.protein;
  return (
    <button
      type="button"
      onClick={() => nav('/food/shop')}
      className={`block w-full rounded-card bg-surface px-5 py-4 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] active:bg-surface-2 ${className}`}
      data-testid="weekly-shop-row"
    >
      <span className="flex items-baseline justify-between gap-3">
        <span className="cap">Weekly shop</span>
        <span className="num text-[13px] text-muted">{fmtWeekRange(shop.week)}</span>
      </span>
      <span className="serif mt-3 block text-[1.625rem]">
        {toBuy} to buy{inAlready > 0 ? `, ${inAlready} in already` : ''}.
      </span>
      <span className="mt-1.5 flex items-center justify-between gap-3">
        <span className="num text-[13px] text-muted">
          {short > 0 ? `${fmtNum(short)} g protein short of the week` : `Reaches the week's ${fmtNum(shop.targets.protein)} g protein`}
        </span>
        <ChevronIcon className="shrink-0" />
      </span>
    </button>
  );
}
