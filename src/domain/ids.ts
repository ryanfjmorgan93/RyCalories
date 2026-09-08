/** Stable UUIDs everywhere. Random for new records; deterministic (SHA-256 based) for imports. */

export function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Fallback (non-secure contexts): RFC 4122 v4 from Math.random.
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  return bytesToUuid(b, 4);
}

function bytesToUuid(b: Uint8Array, version: number): string {
  b[6] = (b[6] & 0x0f) | (version << 4);
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Deterministic UUID (v5-shaped, SHA-256 truncated) from a namespace + name.
 * Re-importing the same source data yields the same ids, which is what makes imports idempotent.
 */
export async function stableUuid(namespace: string, name: string): Promise<string> {
  const data = new TextEncoder().encode(`${namespace} ${name}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bytesToUuid(new Uint8Array(digest).slice(0, 16), 5);
}
