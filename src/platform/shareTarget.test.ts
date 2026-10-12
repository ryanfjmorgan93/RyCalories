/**
 * Iron as an Android share target: the manifest declares it, and what arrives is read and handed to
 * the Body card. The plugin itself and the phone's filesystem are the native boundary and are faked;
 * the parser, the store and the decision logic are real. The share sheet itself cannot be driven from
 * here, which is why the manifest is read as the file it is rather than trusted from a comment.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const toastMock = vi.hoisted(() => vi.fn());
const fs = vi.hoisted(() => ({ readFile: vi.fn() }));
vi.mock('@/ui/components/Toast', () => ({ toast: toastMock }));
vi.mock('@capacitor/filesystem', () => ({ Filesystem: fs }));
vi.mock('@capgo/capacitor-share-target', () => ({ CapacitorShareTarget: { addListener: vi.fn() } }));

import { handleSharedContent, looksLikeCsvFile, readSharedFile } from './shareTarget';
import { useInbodyShare } from '@/state/inbodyShare';

const CSV = readFileSync(fileURLToPath(new URL('../../e2e/fixtures/inbody/inbody-phone.csv', import.meta.url)), 'utf8');
const MANIFEST = readFileSync(fileURLToPath(new URL('../../android/app/src/main/AndroidManifest.xml', import.meta.url)), 'utf8');
const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');

beforeEach(() => {
  vi.clearAllMocks();
  useInbodyShare.getState().clear();
});

describe('AndroidManifest.xml', () => {
  const activity = /<activity\b[\s\S]*?<\/activity>/.exec(MANIFEST)![0];
  const sendFilters = [...activity.matchAll(/<intent-filter>[\s\S]*?<\/intent-filter>/g)].map((m) => m[0]).filter((f) => f.includes('android.intent.action.SEND"'));

  it('offers Iron in the share sheet for CSV and plain text, on MainActivity', () => {
    expect(activity).toContain('android:name=".MainActivity"');
    expect(sendFilters).toHaveLength(1);
    const types = [...sendFilters[0].matchAll(/android:mimeType="([^"]+)"/g)].map((m) => m[1]);
    expect(types).toEqual(expect.arrayContaining(['text/csv', 'text/comma-separated-values', 'application/csv', 'text/plain']));
    expect(sendFilters[0]).toContain('android.intent.category.DEFAULT');
  });

  it('keeps the launcher filter, and takes nothing it was not asked for (no wildcard, no images)', () => {
    expect(activity).toContain('android.intent.action.MAIN');
    expect(activity).toContain('android.intent.category.LAUNCHER');
    expect(sendFilters[0]).not.toMatch(/mimeType="[^"]*\*/);
    expect(sendFilters[0]).not.toContain('image/');
  });
});

describe('looksLikeCsvFile', () => {
  it('goes by type, and by name when the type is vague', () => {
    expect(looksLikeCsvFile({ name: 'InBody.csv', mimeType: 'text/csv' })).toBe(true);
    expect(looksLikeCsvFile({ name: 'x', mimeType: 'text/comma-separated-values' })).toBe(true);
    expect(looksLikeCsvFile({ name: 'x', mimeType: 'application/csv' })).toBe(true);
    expect(looksLikeCsvFile({ name: 'x', mimeType: 'text/plain; charset=utf-8' })).toBe(true);
    expect(looksLikeCsvFile({ name: 'export.csv', mimeType: 'application/octet-stream' })).toBe(true);
    expect(looksLikeCsvFile({ name: 'scan.png', mimeType: 'image/png' })).toBe(false);
    expect(looksLikeCsvFile({ name: 'report.pdf', mimeType: 'application/pdf' })).toBe(false);
    expect(looksLikeCsvFile({ name: 'blob', mimeType: 'application/octet-stream' })).toBe(false);
  });
});

describe('readSharedFile', () => {
  it('reads a cached path through the Filesystem plugin, as bytes', async () => {
    fs.readFile.mockResolvedValue({ data: b64(CSV) });
    expect(await readSharedFile({ uri: '/data/user/0/app/cache/shared_files/InBody.csv', name: 'InBody.csv', mimeType: 'text/csv' })).toBe(CSV);
    expect(fs.readFile).toHaveBeenCalledWith({ path: '/data/user/0/app/cache/shared_files/InBody.csv' });
  });

  it('decodes a UTF-16 export properly rather than mangling it', async () => {
    const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Date,Weight(kg)\n2026-08-04,81.5', 'utf16le')]);
    fs.readFile.mockResolvedValue({ data: bytes.toString('base64') });
    expect(await readSharedFile({ uri: '/x.csv', name: 'x.csv', mimeType: 'text/csv' })).toBe('Date,Weight(kg)\n2026-08-04,81.5');
  });

  it('reads a data URL, base64 or percent-encoded, without touching the filesystem', async () => {
    expect(await readSharedFile({ uri: `data:text/csv;base64,${b64(CSV)}`, name: 'a', mimeType: 'text/csv' })).toBe(CSV);
    expect(await readSharedFile({ uri: `data:text/csv,${encodeURIComponent('Date,Weight\n1,2')}`, name: 'a', mimeType: 'text/csv' })).toBe('Date,Weight\n1,2');
    expect(fs.readFile).not.toHaveBeenCalled();
  });

  it('falls back to fetching the file through the WebView when the plugin cannot read it', async () => {
    fs.readFile.mockRejectedValue(new Error('denied'));
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new TextEncoder().encode(CSV).buffer });
    vi.stubGlobal('fetch', fetchMock);
    try {
      expect(await readSharedFile({ uri: '/cache/InBody.csv', name: 'InBody.csv', mimeType: 'text/csv' })).toBe(CSV);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('gives up with the plugin\'s error when neither way works', async () => {
    fs.readFile.mockRejectedValue(new Error('denied'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    try {
      await expect(readSharedFile({ uri: '/cache/x.csv', name: 'x.csv', mimeType: 'text/csv' })).rejects.toThrow('denied');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('handleSharedContent', () => {
  const navigate = vi.fn();
  const read = vi.fn();
  const deps = { navigate, read };
  const file = { uri: '/cache/InBody.csv', name: 'InBody.csv', mimeType: 'text/csv' };

  beforeEach(() => {
    navigate.mockReset();
    read.mockReset();
  });

  it('parses a shared CSV, leaves it for the Body card and goes to Progress', async () => {
    read.mockResolvedValue(CSV);
    expect(await handleSharedContent({ title: '', texts: [], files: [file] }, deps)).toBe('opened');
    const { pending, fileName } = useInbodyShare.getState();
    expect(pending?.scans.map((s) => s.date)).toEqual(['2026-05-05', '2026-06-02', '2026-07-07', '2026-08-04']);
    expect(fileName).toBe('InBody.csv');
    expect(navigate).toHaveBeenCalledWith('/progress');
    expect(read).toHaveBeenCalledWith(file);
  });

  it('still opens the sheet for a file with no scans in it, so the reason is on screen', async () => {
    read.mockResolvedValue('Name,Colour\nA,blue');
    expect(await handleSharedContent({ title: '', texts: [], files: [file] }, deps)).toBe('opened');
    expect(useInbodyShare.getState().pending?.scans).toEqual([]);
    expect(useInbodyShare.getState().pending?.skipped[0].reason).toMatch(/No date column/);
    expect(navigate).toHaveBeenCalledWith('/progress');
  });

  it('takes the CSV out of a share that also carries other files', async () => {
    read.mockResolvedValue(CSV);
    const png = { uri: '/cache/a.png', name: 'a.png', mimeType: 'image/png' };
    expect(await handleSharedContent({ title: '', texts: [], files: [png, file] }, deps)).toBe('opened');
    expect(read).toHaveBeenCalledWith(file);
  });

  it('says so, and leaves the store alone, when the file cannot be read', async () => {
    read.mockRejectedValue(new Error('denied'));
    expect(await handleSharedContent({ title: '', texts: [], files: [file] }, deps)).toBe('failed');
    expect(toastMock).toHaveBeenCalledWith('Could not read that file', 'danger');
    expect(useInbodyShare.getState().pending).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('reads CSV shared as text, when it holds scans', async () => {
    expect(await handleSharedContent({ title: '', texts: [CSV], files: [] }, deps)).toBe('opened');
    expect(useInbodyShare.getState().pending?.scans).toHaveLength(4);
    expect(navigate).toHaveBeenCalledWith('/progress');
    expect(read).not.toHaveBeenCalled();
  });

  it('ignores a link or a sentence shared as text, without a word', async () => {
    expect(await handleSharedContent({ title: 'A page', texts: ['https://example.com/page'], files: [] }, deps)).toBe('ignored');
    expect(toastMock).not.toHaveBeenCalled();
    expect(useInbodyShare.getState().pending).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('tells the owner when a share had something in it but nothing Iron can import', async () => {
    expect(await handleSharedContent({ title: '', texts: [], files: [{ uri: '/cache/a.png', name: 'a.png', mimeType: 'image/png' }] }, deps)).toBe('ignored');
    expect(toastMock).toHaveBeenCalledWith('Nothing to import from that share');
    expect(await handleSharedContent({ title: '', texts: ['line one\nline two'], files: [] }, deps)).toBe('ignored');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('copes with a plugin event that has no files or texts arrays', async () => {
    expect(await handleSharedContent({ title: '' } as never, deps)).toBe('ignored');
  });
});
