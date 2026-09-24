/**
 * The meal-photo pipeline: downscale a picked photo, write it to the Filesystem cache for the
 * native `Nano.analyzeMeal` plugin to read by path (a Capacitor plugin call is JSON only — a photo
 * crosses the bridge as a path, never as base64 in the call itself), and clean up afterwards.
 *
 * The photo is NEVER stored on a meal or a recipe — it exists only for the seconds recognition
 * takes. `deleteMealPhoto` removes it once recognition finishes (success, failure or cancel — the
 * caller's `finally`); `sweepMealPhotos` is the backstop the builder runs on every mount, in case a
 * crash mid-analysis left one behind.
 */
import { Directory, Filesystem } from '@capacitor/filesystem';
import { uuid } from '@/domain/ids';

const FOLDER = 'meal-photos';

/** The longest edge a photo is scaled to before it is handed to the model — an app estimate, not
 * a documented model limit (see the plan's native notes). */
const MAX_EDGE = 1024;

const JPEG_QUALITY = 0.85;

export interface PreparedPhoto {
  /** The `file://` (or web blob) URI Filesystem reports for the written file — not used for the
   * analyse call itself (that takes `path`), but handy for anything that wants to display it. */
  uri: string;
  /** Path relative to `Directory.Cache`, e.g. "meal-photos/<uuid>.jpg" — what `Nano.analyzeMeal`
   * is given, and what `deleteMealPhoto` takes back. */
  path: string;
}

/**
 * Downscale a picked photo to at most `MAX_EDGE` on its longest edge, re-encode as JPEG, and write
 * it under `meal-photos/` in the cache directory. `imageOrientation: 'from-image'` reads the photo's
 * own EXIF orientation so a portrait shot from the camera does not land on its side.
 */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not prepare the photo.');
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    if (!blob) throw new Error('Could not prepare the photo.');

    const path = `${FOLDER}/${uuid()}.jpg`;
    const written = await Filesystem.writeFile({
      path,
      directory: Directory.Cache,
      data: await blobToBase64(blob),
      recursive: true,
    });
    return { uri: written.uri, path };
  } finally {
    bitmap.close();
  }
}

/** Best-effort delete of one photo. Never throws: a file left behind in the cache is a tidiness
 * issue `sweepMealPhotos` catches on the next visit, not a failure worth surfacing. */
export async function deleteMealPhoto(path: string): Promise<void> {
  try {
    await Filesystem.deleteFile({ path, directory: Directory.Cache });
  } catch {
    /* best effort — see doc comment */
  }
}

/**
 * Delete everything under `meal-photos/` in the cache. Run when the recipe builder opens, so a
 * photo a crash left behind mid-analysis (recognition never reached its `finally`) does not sit on
 * the device indefinitely. Best-effort throughout: a folder that does not exist yet, or a file that
 * cannot be removed, is not an error worth surfacing here.
 */
export async function sweepMealPhotos(): Promise<void> {
  let files: { name: string; type: string }[];
  try {
    files = (await Filesystem.readdir({ path: FOLDER, directory: Directory.Cache })).files;
  } catch {
    return; // no folder yet — nothing to sweep
  }
  for (const f of files) {
    if (f.type !== 'file') continue;
    try {
      await Filesystem.deleteFile({ path: `${FOLDER}/${f.name}`, directory: Directory.Cache });
    } catch {
      /* best effort, per file */
    }
  }
}

/** Base64 without a data: prefix, chunked so a multi-megabyte photo never blows the call stack on
 * `String.fromCharCode(...bytes)`. */
async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
