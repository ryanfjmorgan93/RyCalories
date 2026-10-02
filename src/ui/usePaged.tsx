import { useCallback, useEffect, useState } from 'react';
import { LIST_PAGE_SIZE, pageWindow } from '@/domain/library';
import { Button } from './components/Button';

/** The nearest ancestor that scrolls on its own (a sheet's list), or null when the page itself does. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    const overflowY = getComputedStyle(p).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') return p;
  }
  return null;
}

/**
 * Draw a long list a page at a time. `total` is how many rows there are; `resetKey` names what the
 * list is (the filter and search behind it): when it changes the list starts again at the first
 * page, and stays there when the key comes back to an earlier value. The next page is drawn when
 * the sentinel (`sentinelRef`, on an element placed after the last drawn row) comes within a screen
 * of view, in the list's own scroll box when it has one; where the browser has no
 * IntersectionObserver the More button (`MoreRows`) is the way on. A sentinel still in view after a
 * page is drawn brings the next one, so a tall screen fills.
 *
 * The sentinel is kept in state, not in a ref object, so the observer is attached whenever the
 * element appears: a sheet mounts its list only while it is open, after this hook first ran, and an
 * effect that looked the element up once never saw it. `initialPages` starts a list part-way
 * through, for a screen coming back to where it was; `pages` is how far it has got.
 */
export function usePaged(
  total: number,
  resetKey: string,
  size = LIST_PAGE_SIZE,
  initialPages = 1,
): { shown: number; more: boolean; loadMore: () => void; sentinelRef: (el: HTMLDivElement | null) => void; pages: number } {
  const [state, setState] = useState({ key: resetKey, pages: Math.max(1, initialPages) });
  // A different list starts again at its first page. Reset in the render that sees the new key, not
  // only when reading: a key that was left and came back (All, Yours, All) must not find its old page count waiting.
  if (state.key !== resetKey) setState({ key: resetKey, pages: 1 });
  const pages = state.key === resetKey ? state.pages : 1;
  const { shown, more } = pageWindow(total, pages, size);
  const loadMore = useCallback(() => setState((s) => ({ key: resetKey, pages: (s.key === resetKey ? s.pages : 1) + 1 })), [resetKey]);

  const [el, sentinelRef] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!el || !more || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (hits) => {
        if (hits.some((h) => h.isIntersecting)) loadMore();
      },
      { root: scrollParent(el), rootMargin: '0px 0px 600px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [el, more, shown, loadMore]);

  return { shown, more, loadMore, sentinelRef, pages };
}

/** After the last drawn row: the sentinel that brings the next page, with a plain button for when it cannot. */
export function MoreRows({ sentinelRef, onMore }: { sentinelRef: (el: HTMLDivElement | null) => void; onMore: () => void }) {
  return (
    <div ref={sentinelRef} className="p-3">
      <Button full variant="outline" onClick={onMore} data-testid="exercise-more">
        More
      </Button>
    </div>
  );
}
