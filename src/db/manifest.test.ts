/**
 * Nothing leaves the phone through Android's own backup. The app keeps its own backups
 * (Documents/Iron, Settings → Export), and Settings → About lists the only things that leave the
 * device; an `allowBackup="true"` manifest with no rules uploads the whole IndexedDB to the
 * owner's Google account behind that list's back. Same shape as db.test.ts's DB_VERSION check: read
 * the real file, not a copy of it.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const MANIFEST = readFileSync(fileURLToPath(new URL('../../android/app/src/main/AndroidManifest.xml', import.meta.url)), 'utf8');

/** The attributes of the one `<application ...>` opening tag. */
function applicationTag(xml: string): string {
  const match = /<application\b[^>]*>/.exec(xml);
  if (!match) throw new Error('AndroidManifest.xml has no <application> element');
  return match[0];
}

describe('AndroidManifest.xml', () => {
  it('turns Android backup off', () => {
    const tag = applicationTag(MANIFEST);
    expect(tag.match(/android:allowBackup="([^"]*)"/g)).toEqual(['android:allowBackup="false"']);
  });

  it('declares no backup rules that would switch it back on for some data', () => {
    const tag = applicationTag(MANIFEST);
    expect(tag).not.toContain('android:fullBackupContent');
    expect(tag).not.toContain('android:dataExtractionRules');
  });
});
