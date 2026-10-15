import type { Page } from '@playwright/test';

/**
 * Text on the page that something cuts off: letters whose ink crosses the edge of a box that clips
 * (`overflow: hidden/clip`, e.g. a tail of g or y under a tight line-height), text running out of
 * the right of one, an ellipsis, or a line clamp that is hiding lines. Each is "screen: what, text".
 *
 * Ink is measured, not guessed: canvas `measureText` gives the font's box and the text's own ascent
 * and descent, laid over the text's real line boxes (`Range.getClientRects`).
 */
export function clippedText(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    await document.fonts.ready;
    const found: string[] = [];
    const ctx = document.createElement('canvas').getContext('2d')!;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const clips = (el: Element) => {
      const boxes: { top: number; left: number; bottom: number; right: number; x: boolean; y: boolean }[] = [];
      for (let a: Element | null = el; a && a !== document.body; a = a.parentElement) {
        const { overflowX: ox, overflowY: oy } = getComputedStyle(a);
        if (/auto|scroll/.test(ox + oy)) continue; // a scroller, not a clip
        if (!/hidden|clip/.test(ox + oy)) continue;
        const r = a.getBoundingClientRect();
        const top = r.top + a.clientTop;
        const left = r.left + a.clientLeft;
        if (a.clientWidth <= 2 || a.clientHeight <= 2) continue; // visually hidden text
        boxes.push({ top, left, bottom: top + a.clientHeight, right: left + a.clientWidth, x: ox !== 'visible', y: oy !== 'visible' });
      }
      return boxes;
    };
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const text = (node.textContent ?? '').trim();
      const el = node.parentElement;
      if (!text || !el) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden') continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const lines = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
      if (!lines.length) continue;
      ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const m = ctx.measureText(text);
      const what = `${text.slice(0, 50)} (${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 4).join('.')})`;
      for (const box of clips(el)) {
        const cut = lines.find((r) => {
          const inkTop = r.top + m.fontBoundingBoxAscent - m.actualBoundingBoxAscent;
          const inkBottom = r.bottom - m.fontBoundingBoxDescent + m.actualBoundingBoxDescent;
          const outside = inkTop >= box.bottom || inkBottom <= box.top; // a whole line hidden: the clamp check's job
          return (box.y && !outside && (inkBottom > box.bottom + 0.75 || inkTop < box.top - 0.75)) || (box.x && r.left < box.right && r.right > box.right + 0.75);
        });
        if (cut) {
          found.push(`cut: ${what}`);
          break;
        }
      }
      if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) found.push(`ellipsis: ${what}`);
      if (cs.webkitLineClamp !== 'none' && el.scrollHeight > el.clientHeight + 1) found.push(`clamped: ${what}`);
    }
    return [...new Set(found)];
  });
}
