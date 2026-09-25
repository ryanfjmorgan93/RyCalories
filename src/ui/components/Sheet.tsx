import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { popSheet, pushSheet, type SheetHandle } from '@/state/overlays';
import { Button } from './Button';
import {
  decideDragIntent,
  dragOffset,
  releaseVelocity,
  scrimOpacity,
  shouldDismiss,
  type DragIntent,
  type DragSample,
} from './sheetGesture';

// Ref-counted body scroll lock: several sheets can be open (a Confirm stacked on an editor) and
// unmount in any order without leaving the page stuck unscrollable.
let scrollLocks = 0;
let savedOverflow = '';
function lockScroll() {
  if (scrollLocks === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLocks++;
}
function unlockScroll() {
  scrollLocks = Math.max(0, scrollLocks - 1);
  if (scrollLocks === 0) document.body.style.overflow = savedOverflow;
}

/** How long the panel takes to slide back up, or away. The global reduced-motion rule in
 *  src/index.css cuts the CSS transition to nothing; the timers below follow it. */
const SETTLE_MS = 200;
const LEAVE_MS = 160;

type DragState = 'idle' | 'dragging' | 'settling';

interface Gesture {
  startX: number;
  startY: number;
  lastY: number;
  intent: DragIntent;
  fromHandle: boolean;
  scrollEligible: boolean;
  samples: DragSample[];
}

/**
 * Bottom sheet. Closes on a pull down (from the handle and title anywhere, from the body once
 * its list is at the top), a tap on the scrim or the handle, Escape, or the Android back
 * gesture — the last two through the shared stack in src/state/overlays.ts, so only the topmost
 * sheet closes. Every route out calls the caller's `onClose`, which may decline: HevyImportSheet
 * passes a no-op while importing, and the panel slides back.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const handle = useRef<SheetHandle>({ close: onClose });
  useLayoutEffect(() => {
    handle.current.close = onClose;
  });

  const panelRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = handle.current;
    lockScroll();
    pushSheet(h);
    return () => {
      unlockScroll();
      popSheet(h);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const scrim = scrimRef.current;
    if (!panel || !scrim) return;

    let gesture: Gesture | null = null;
    let busy = false; // sliding back or away: a new touch waits for it
    const timers: number[] = [];
    const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Written straight onto the element, not through React state: it changes inside the touch
    // handlers themselves, so a test watching it sees a drag the moment it starts, never a
    // render later.
    const setDragState = (state: DragState) => {
      panel.dataset.dragState = state;
    };

    const place = (offset: number) => {
      panel.style.transform = offset > 0 ? `translateY(${offset}px)` : '';
      scrim.style.opacity = offset > 0 ? String(scrimOpacity(offset, panel.offsetHeight)) : '';
    };

    const settleBack = () => {
      busy = true;
      setDragState('settling');
      scrim.style.pointerEvents = '';
      panel.style.transition = `transform ${SETTLE_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`;
      scrim.style.transition = `opacity ${SETTLE_MS}ms ease`;
      place(0);
      timers.push(
        window.setTimeout(
          () => {
            panel.style.transition = '';
            scrim.style.transition = '';
            busy = false;
            setDragState('idle');
          },
          reducedMotion() ? 0 : SETTLE_MS,
        ),
      );
    };

    const leave = () => {
      busy = true;
      setDragState('settling');
      const active = document.activeElement;
      if (active instanceof HTMLElement && panel.contains(active)) active.blur();
      // A tap on the scrim during the slide-out would close it a second time; for a caller whose
      // "close" means "next step" (HevyImportSheet's result), that is a skipped step.
      scrim.style.pointerEvents = 'none';
      panel.style.transition = `transform ${LEAVE_MS}ms ease-in`;
      scrim.style.transition = `opacity ${LEAVE_MS}ms ease-in`;
      panel.style.transform = `translateY(${panel.offsetHeight + 24}px)`;
      scrim.style.opacity = '0';
      timers.push(
        window.setTimeout(
          () => {
            handle.current.close();
            // A caller that closed has unmounted the panel by the next frame. One that declined
            // (or turned "close" into "next step") still has it: bring it back up.
            requestAnimationFrame(() => {
              if (panel.isConnected) settleBack();
            });
          },
          reducedMotion() ? 0 : LEAVE_MS,
        ),
      );
    };

    const onTouchStart = (e: TouchEvent) => {
      if (busy || e.touches.length !== 1) {
        gesture = null;
        return;
      }
      const t = e.touches[0]!;
      const target = e.target instanceof Element ? e.target : null;
      if (!target || target.closest('[data-sheet-nodrag]')) {
        gesture = null;
        return;
      }
      gesture = {
        startX: t.clientX,
        startY: t.clientY,
        lastY: t.clientY,
        intent: 'pending',
        fromHandle: !!target.closest('[data-sheet-handle]'),
        scrollEligible: scrolledToTop(target, panel),
        samples: [{ y: t.clientY, t: e.timeStamp }],
      };
    };

    const onTouchMove = (e: TouchEvent) => {
      const g = gesture;
      if (!g) return;
      if (e.touches.length !== 1) {
        // A second finger: this is not a drag any more.
        gesture = null;
        if (g.intent === 'drag') settleBack();
        return;
      }
      const t = e.touches[0]!;
      if (g.intent === 'pending') {
        g.intent = decideDragIntent(t.clientX - g.startX, t.clientY - g.startY, g.fromHandle, g.scrollEligible);
        if (g.intent !== 'drag') return;
        if (!e.cancelable) {
          // The browser already owns this touch as a scroll; fighting it would move both.
          g.intent = 'scroll';
          return;
        }
        panel.style.animation = 'none'; // an entrance still running would fight the finger
        panel.style.transition = '';
        scrim.style.transition = '';
        setDragState('dragging');
      }
      if (g.intent !== 'drag') return;
      if (e.cancelable) e.preventDefault();
      g.lastY = t.clientY;
      g.samples.push({ y: t.clientY, t: e.timeStamp });
      if (g.samples.length > 32) g.samples.splice(0, g.samples.length - 32);
      place(dragOffset(t.clientY - g.startY));
    };

    const onTouchEnd = (e: TouchEvent) => {
      const g = gesture;
      gesture = null;
      if (!g || g.intent !== 'drag') return;
      if (e.type === 'touchcancel') {
        settleBack();
        return;
      }
      g.samples.push({ y: g.lastY, t: e.timeStamp });
      const distance = dragOffset(g.lastY - g.startY);
      if (shouldDismiss({ distance, panelHeight: panel.offsetHeight, velocityPxMs: releaseVelocity(g.samples) })) leave();
      else settleBack();
    };

    panel.addEventListener('touchstart', onTouchStart, { passive: true });
    panel.addEventListener('touchmove', onTouchMove, { passive: false });
    panel.addEventListener('touchend', onTouchEnd, { passive: true });
    panel.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      panel.removeEventListener('touchstart', onTouchStart);
      panel.removeEventListener('touchmove', onTouchMove);
      panel.removeEventListener('touchend', onTouchEnd);
      panel.removeEventListener('touchcancel', onTouchEnd);
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true">
      <div ref={scrimRef} className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        ref={panelRef}
        data-drag-state="idle"
        data-testid="sheet-panel"
        className="glass-fixed sheet-in relative flex max-h-[92dvh] flex-col rounded-t-card border-t"
      >
        <div data-sheet-handle className="touch-none">
          <button type="button" aria-label="Close" onClick={onClose} className="flex w-full justify-center pt-2 pb-1">
            <span className="h-1.5 w-12 rounded-full bg-line" />
          </button>
          {title && <div className="px-5 pb-2 pt-1 text-lg font-bold">{title}</div>}
        </div>
        <div className="overflow-y-auto overscroll-contain px-5 pb-4" data-testid="sheet-body">
          {children}
        </div>
        {footer && <div className="border-t border-line px-5 pt-3 pb-safe">{footer}<div className="h-3" /></div>}
        {!footer && <div className="pb-safe" />}
      </div>
    </div>,
    document.body,
  );
}

/**
 * True when nothing between the finger and the panel is scrolled down: every box that can
 * scroll vertically (the sheet body, a long list inside it, a textarea) sits at its top. Only
 * then may a pull down close the sheet instead of scrolling back up.
 */
function scrolledToTop(target: Element, panel: HTMLElement): boolean {
  for (let el: Element | null = target; el && el !== panel; el = el.parentElement) {
    if (!(el instanceof HTMLElement)) continue;
    if (el.scrollTop > 0 && el.scrollHeight > el.clientHeight) {
      const overflowY = getComputedStyle(el).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') return false;
    }
  }
  return true;
}

export interface ConfirmProps {
  open: boolean;
  title: ReactNode;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function Confirm({ open, title, body, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger, onConfirm, onCancel }: ConfirmProps) {
  return (
    <Sheet open={open} onClose={onCancel} title={title}>
      {body && <div className="text-muted">{body}</div>}
      <div className="mt-5 grid grid-cols-2 gap-3">
        <Button size="lg" variant="secondary" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button size="lg" variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Sheet>
  );
}
