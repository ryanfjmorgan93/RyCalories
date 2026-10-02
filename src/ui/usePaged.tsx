import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { LIST_PAGE_SIZE, pageWindow } from '@/domain/library';
import { Button } from './components/Button';

/**
 * Draw a long list a page at a time. `total` is how many rows there are; `resetKey` names what the
 * list is (the filter and search behind it): when it changes the list starts again at the first
 * page. The next page is drawn when `sentinelRef`'s element, placed after the last drawn row,
 * comes within a screen of view; where the browser has no IntersectionObserver the More button
 * (`MoreRows`) is the way on. A sentinel still in view after a page is drawn brings the next one,
 * so a tall screen fills.
 */
export function usePaged(total: number, resetKey: string, size = LIST_PAGE_SIZE): { shown: number; more: boolean; loadMore: () => void; sentinelRef: RefObject<HTMLDivElement | null> } {
  const [state, setState] = useState({ key: resetKey, pages: 1 });
  const pages = state.key === resetKey ? state.pages : 1;
  const { shown, more } = pageWindow(total, pages, size);
  const loadMore = useCallback(() => setState((s) => ({ key: resetKey, pages: (s.key === resetKey ? s.pages : 1) + 1 })), [resetKey]);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !more || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (hits) => {
        if (hits.some((h) => h.isIntersecting)) loadMore();
      },
      { rootMargin: '0px 0px 600px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [more, shown, loadMore]);

  return { shown, more, loadMore, sentinelRef };
}

/** After the last drawn row: the sentinel that brings the next page, with a plain button for when it cannot. */
export function MoreRows({ sentinelRef, onMore }: { sentinelRef: RefObject<HTMLDivElement | null>; onMore: () => void }) {
  return (
    <div ref={sentinelRef} className="p-3">
      <Button full variant="outline" onClick={onMore} data-testid="exercise-more">
        More
      </Button>
    </div>
  );
}
