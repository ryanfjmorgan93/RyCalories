/**
 * Iron as a target in Android's share sheet: share the InBody app's CSV export to Iron, and the
 * import sheet opens on Progress with the scans it holds. The manifest side is the SEND intent
 * filters on MainActivity (android/app/src/main/AndroidManifest.xml); this is the JavaScript side.
 *
 * A no-op everywhere but the phone. On the web nothing can be shared in, and the Progress card's
 * file picker is the way in.
 *
 * What the plugin hands over (@capgo/capacitor-share-target's README): `files`, each with a `uri`
 * that is "a file path or data URL" on Android (the plugin copies the shared stream into the app's
 * cache first, so the path is readable), a `name` and a `mimeType`; and `texts`, for shares that
 * carry text instead of a file.
 *
 * Known limit of the plugin, not worked around here: on a cold start it emits the launching share
 * from its own `load()`, before any JavaScript listener exists, and Capacitor does not retain the
 * event. A share while Iron is already running (foreground or background) is delivered; one that
 * launches Iron from scratch may be dropped, and the file picker on Progress is the fallback.
 */
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { Filesystem } from '@capacitor/filesystem';
import { CapacitorShareTarget, type ShareReceivedEvent, type SharedFile } from '@capgo/capacitor-share-target';
import { decodeInbodyBytes, parseInbodyCsv } from '@/domain/inbody';
import { useInbodyShare } from '@/state/inbodyShare';
import { toast } from '@/ui/components/Toast';

const CSV_TYPES = new Set(['text/csv', 'text/comma-separated-values', 'application/csv', 'application/vnd.ms-excel', 'text/plain']);

/** Whether a shared file could be a CSV export: by its type, or by its name when the type is a vague one. */
export function looksLikeCsvFile(file: Pick<SharedFile, 'name' | 'mimeType'>): boolean {
  const type = file.mimeType.toLowerCase().split(';')[0].trim();
  if (CSV_TYPES.has(type)) return true;
  return /\.(csv|txt)$/i.test(file.name) && (type === 'application/octet-stream' || type === '' || type.startsWith('text/'));
}

function bytesOfBase64(base64: string): Uint8Array {
  const bin = atob(base64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesOfDataUrl(uri: string): Uint8Array {
  const comma = uri.indexOf(',');
  const head = uri.slice(5, comma);
  const body = uri.slice(comma + 1);
  return head.includes(';base64') ? bytesOfBase64(body) : new TextEncoder().encode(decodeURIComponent(body));
}

/**
 * The text of a shared file. A data URL is decoded in place; a path is read through the Filesystem
 * plugin (as bytes, so a UTF-16 or Windows-1252 export is decoded properly rather than mangled),
 * and failing that fetched through the WebView's file route.
 */
export async function readSharedFile(file: SharedFile): Promise<string> {
  const uri = file.uri;
  if (uri.startsWith('data:')) return decodeInbodyBytes(bytesOfDataUrl(uri));
  try {
    const { data } = await Filesystem.readFile({ path: uri });
    if (typeof data === 'string') return decodeInbodyBytes(bytesOfBase64(data));
    return decodeInbodyBytes(new Uint8Array(await data.arrayBuffer()));
  } catch (first) {
    try {
      const res = await fetch(Capacitor.convertFileSrc(uri));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return decodeInbodyBytes(new Uint8Array(await res.arrayBuffer()));
    } catch {
      throw first;
    }
  }
}

export interface ShareDeps {
  read: (file: SharedFile) => Promise<string>;
  navigate: (to: string) => void;
}

/**
 * Take what was shared, parse it and hand it to the Body card. A file always opens the import sheet,
 * even if nothing in it parsed, because the sheet is where the owner sees why. Text alone opens it
 * only when it holds scans: Iron shows up for every plain-text share, and a link shared by mistake
 * should not open a sheet that says "no scans".
 */
export async function handleSharedContent(event: ShareReceivedEvent, deps: ShareDeps): Promise<'opened' | 'ignored' | 'failed'> {
  const offer = useInbodyShare.getState().offer;
  const file = (event.files ?? []).find(looksLikeCsvFile);
  if (file) {
    try {
      offer(parseInbodyCsv(await deps.read(file)), file.name);
      deps.navigate('/progress');
      return 'opened';
    } catch {
      toast('Could not read that file', 'danger');
      return 'failed';
    }
  }
  for (const text of event.texts ?? []) {
    if (!text.includes('\n')) continue;
    const parsed = parseInbodyCsv(text);
    if (parsed.scans.length > 0) {
      offer(parsed);
      deps.navigate('/progress');
      return 'opened';
    }
  }
  if ((event.files ?? []).length > 0 || (event.texts ?? []).some((t) => t.includes('\n'))) toast('Nothing to import from that share');
  return 'ignored';
}

/** Mount once, inside the router (src/App.tsx). Renders nothing. */
export function ShareTargetListener(): null {
  const navigate = useNavigate();
  // The router's navigate changes with the location; the listener must outlive that.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let cancelled = false;
    let remove: (() => void) | undefined;
    void CapacitorShareTarget.addListener('shareReceived', (event) => {
      void handleSharedContent(event, { read: readSharedFile, navigate: (to) => navigateRef.current(to) });
    })
      .then((handle) => {
        if (cancelled) void handle.remove();
        else remove = () => void handle.remove();
      })
      .catch(() => {
        /* the plugin is not there (an old APK): the file picker still works */
      });
    return () => {
      cancelled = true;
      remove?.();
    };
  }, []);

  return null;
}
