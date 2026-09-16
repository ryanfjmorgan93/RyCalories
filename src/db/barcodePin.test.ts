import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `barcode-detector`'s JS glue calls into a specific build of `zxing-wasm`'s exported bindings,
 * and we separately import `zxing-wasm/reader/zxing_reader.wasm` ourselves to bundle the actual
 * .wasm binary offline (see src/ui/BarcodeScanner.tsx). Those two things — the JS bindings the
 * ponyfill was written against, and the .wasm binary we ship — have to be the exact same build.
 * A minor-version bump of either side is a WebAssembly ABI change (exported function signatures,
 * memory layout), not a semver-compatible one, so npm's usual "^" range gives no protection here:
 * two different resolved copies of `zxing-wasm` would not fail to install, they would fail to
 * scan, silently, on every barcode, with no type error to catch it. Pinning our own dependency to
 * exactly what `barcode-detector` itself declares is the only thing that rules that out.
 */
function exactVersion(range: string): string {
  return range.replace(/^[\^~]/, '');
}

describe('barcode-detector / zxing-wasm ABI pin', () => {
  it('pins our zxing-wasm dependency to the exact version barcode-detector depends on', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const root = path.resolve(here, '../..');

    const ourPkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    const barcodeDetectorPkg = JSON.parse(
      readFileSync(path.join(root, 'node_modules/barcode-detector/package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> };

    const ourZxingWasm = ourPkg.dependencies['zxing-wasm'];
    const theirZxingWasm = barcodeDetectorPkg.dependencies['zxing-wasm'];
    expect(ourZxingWasm, 'package.json must declare a zxing-wasm dependency').toBeTruthy();
    expect(theirZxingWasm, 'barcode-detector must declare a zxing-wasm dependency').toBeTruthy();

    expect(exactVersion(ourZxingWasm!)).toBe(exactVersion(theirZxingWasm!));
  });
});
