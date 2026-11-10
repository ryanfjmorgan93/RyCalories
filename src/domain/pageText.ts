/**
 * The readable text of a product web page, for Claude to find its nutrition in. Scripts, styles and
 * tags go; a page's structured data (`application/ld+json`) stays, since some shops put the
 * nutrition only there. A long page is cut to a window around its first "kcal" (or "nutrition"),
 * which keeps what Claude is sent, and paid for, small.
 */
export function pageText(html: string, max = 24_000): string {
  const data = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]!.trim());
  const text = decode(
    html
      .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(br|\/p|\/div|\/li|\/tr|\/h\d|\/td|\/th)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
  const all = [text, ...data].filter(Boolean).join('\n\n');
  if (all.length <= max) return all;
  const at = all.search(/kcal/i) >= 0 ? all.search(/kcal/i) : all.search(/nutrition/i);
  // Mostly after the mark: a nutrition table runs on below its first figure.
  const from = at < 0 ? 0 : Math.max(0, Math.min(at - Math.floor(max / 4), all.length - max));
  return all.slice(from, from + max);
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', pound: '£' };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    return NAMED[code.toLowerCase()] ?? whole;
  });
}

/** A pasted address as a web page to open, or null when it is not one. A bare "tesco.com/…" gets https. */
export function pageUrl(pasted: string): URL | null {
  const s = pasted.trim();
  if (!s || /\s/.test(s)) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname.includes('.') ? url : null;
  } catch {
    return null;
  }
}
