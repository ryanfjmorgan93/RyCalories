import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { popBackAction, pushBackAction, type BackAction } from '@/state/overlays';
import { IconButton } from './Button';

export function TopBar({
  title,
  back,
  right,
  subtitle,
  onBack,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  back?: boolean | string;
  onBack?: () => void;
  right?: ReactNode;
}) {
  const nav = useNavigate();
  const goBack = () => {
    if (onBack) return onBack();
    if (typeof back === 'string') return nav(back);
    if (window.history.length > 1) nav(-1);
    else nav('/');
  };

  // The Android back gesture does exactly what this arrow does (src/state/overlays.ts), so a
  // screen's guard — an unsaved meal asking first — covers both.
  const action = useRef<BackAction>({ run: goBack });
  useLayoutEffect(() => {
    action.current.run = goBack;
  });
  const hasBack = !!back;
  useEffect(() => {
    if (!hasBack) return;
    const a = action.current;
    pushBackAction(a);
    return () => popBackAction(a);
  }, [hasBack]);
  return (
    <header className="glass-fixed pt-safe sticky top-0 z-30 border-b">
      <div className="flex min-h-14 items-center gap-1 px-2 py-1">
        {back ? (
          <IconButton label="Back" onClick={goBack}>
            <BackIcon />
          </IconButton>
        ) : (
          <div className="w-2" />
        )}
        <div className="min-w-0 flex-1">
          {/* A long title wraps and the bar grows: never cut off. */}
          <h1 className="disp break-words text-[1.75rem]">{title}</h1>
          {subtitle && <div className="break-words text-xs text-muted">{subtitle}</div>}
        </div>
        {right}
      </div>
    </header>
  );
}

export function BackIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

export function ChevronIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={`text-dim ${className}`} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}

export function CheckIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

export function MoreIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
    </svg>
  );
}


/** The icons that sit in a primary's well (v5): fine 1.5 strokes on a 24 grid. */
function WellGlyph({ children }: { children: ReactNode }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
export function ArrowIcon() {
  return <WellGlyph><path d="M5 12h14M13 6l6 6-6 6" /></WellGlyph>;
}
export function PlusIcon() {
  return <WellGlyph><path d="M12 5v14M5 12h14" /></WellGlyph>;
}
export function TickIcon() {
  return <WellGlyph><path d="m5 12.5 4.5 4.5L19 7.5" /></WellGlyph>;
}
export function SwordsIcon() {
  return (
    <WellGlyph>
      <path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M9.5 14.5 3 21M5 14l-2 2 5 5 2-2M14.5 9.5 21 3v3l-6.5 6.5" />
    </WellGlyph>
  );
}
