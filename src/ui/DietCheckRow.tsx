import { useNavigate } from 'react-router-dom';
import { fmtDateKey, isoToDateKey } from '@/domain/dates';
import { dietScore } from '@/domain/dietCheck';
import { ChevronIcon } from './components/TopBar';
import { useSettings } from './hooks';

/** The diet check's way in on Food: the last score and when, or what a tap would do. */
export function DietCheckRow({ className = '' }: { className?: string }) {
  const nav = useNavigate();
  const settings = useSettings();
  if (!settings) return null;
  const check = settings.dietCheck;
  return (
    <button
      type="button"
      onClick={() => nav('/food/diet')}
      className={`flex min-h-16 w-full items-center gap-3 rounded-card bg-surface px-5 py-3.5 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] active:bg-surface-2 ${className}`}
      data-testid="diet-check-row"
    >
      <span className="min-w-0 flex-1">
        <span className="cap block">Diet check</span>
        <span className="num mt-1.5 block text-[13px] text-muted">
          {check ? `${dietScore(check)} of 100 ≈ · checked ${fmtDateKey(isoToDateKey(check.at))}` : 'What your food is doing for your goal'}
        </span>
      </span>
      <ChevronIcon className="shrink-0" />
    </button>
  );
}
