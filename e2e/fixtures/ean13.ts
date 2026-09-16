import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** The barcode used throughout the camera scanning suite. A real, valid EAN-13. */
export const FIXTURE_CODE = '5901234123457';

/** Where the fake camera's video fixture is written, relative to the repo root. */
export const Y4M_PATH = 'test-results/fixtures/ean13-5901234123457.y4m';

// L-code (odd parity), G-code (even parity) and R-code (right-hand) tables, 7 bits each, exactly
// as EAN-13/UPC-A define them.
const L_CODE: Record<string, string> = {
  '0': '0001101',
  '1': '0011001',
  '2': '0010011',
  '3': '0111101',
  '4': '0100011',
  '5': '0110001',
  '6': '0101111',
  '7': '0111011',
  '8': '0110111',
  '9': '0001011',
};
const G_CODE: Record<string, string> = {
  '0': '0100111',
  '1': '0110011',
  '2': '0011011',
  '3': '0100001',
  '4': '0011101',
  '5': '0111001',
  '6': '0000101',
  '7': '0010001',
  '8': '0001001',
  '9': '0010111',
};
const R_CODE: Record<string, string> = {
  '0': '1110010',
  '1': '1100110',
  '2': '1101100',
  '3': '1000010',
  '4': '1011100',
  '5': '1001110',
  '6': '1010000',
  '7': '1000100',
  '8': '1001000',
  '9': '1110100',
};
/** Which of the 6 left-hand digits use L vs G encoding, keyed by the leading (13th-from-end,
 * i.e. first) digit of the code. */
const PARITY: Record<string, string> = {
  '0': 'LLLLLL',
  '1': 'LLGLGG',
  '2': 'LLGGLG',
  '3': 'LLGGGL',
  '4': 'LGLLGG',
  '5': 'LGGLLG',
  '6': 'LGGGLL',
  '7': 'LGLGLG',
  '8': 'LGLGGL',
  '9': 'LGGLGL',
};

function checkDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    // Position 1 (index 0) has weight 1, position 2 (index 1) has weight 3, alternating.
    sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * Encode 12 or 13 EAN-13 digits into its 95 black/white modules (`true` = black), start guard to
 * end guard. Given 12 digits the checksum is computed and appended; given 13, the checksum is
 * verified rather than trusted, so a typo in a fixture fails loudly instead of drawing a barcode
 * that does not actually decode to what the test thinks it does.
 */
export function encodeEan13(digits: string): boolean[] {
  if (!/^\d{12,13}$/.test(digits)) {
    throw new Error(`encodeEan13: expected 12 or 13 digits, got "${digits}"`);
  }
  const first12 = digits.slice(0, 12);
  const check = checkDigit(first12);
  if (digits.length === 13 && Number(digits[12]) !== check) {
    throw new Error(`encodeEan13: "${digits}" has an invalid checksum (expected ${check})`);
  }
  const full = first12 + String(check);

  const leadDigit = full[0]!;
  const leftDigits = full.slice(1, 7);
  const rightDigits = full.slice(7, 13);
  const parity = PARITY[leadDigit]!;

  let bits = '101'; // start guard
  for (let i = 0; i < 6; i++) {
    const table = parity[i] === 'L' ? L_CODE : G_CODE;
    bits += table[leftDigits[i]!]!;
  }
  bits += '01010'; // centre guard
  for (let i = 0; i < 6; i++) {
    bits += R_CODE[rightDigits[i]!]!;
  }
  bits += '101'; // end guard

  return bits.split('').map((c) => c === '1');
}

/**
 * Write a Y4M (uncompressed YUV 4:2:0) video of an EAN-13 barcode, for Chromium's
 * `--use-file-for-fake-video-capture` flag to serve as a fake camera. Bars are drawn full black,
 * background full white, and chroma is left neutral throughout — this is a greyscale image and
 * ZXing reads only luma.
 */
export function writeY4m(
  path: string,
  digits: string,
  { width = 640, height = 480, frames = 15 }: { width?: number; height?: number; frames?: number } = {},
): void {
  const modules = encodeEan13(digits);
  const moduleWidthPx = 5;
  const barsWidthPx = modules.length * moduleWidthPx; // 95 * 5 = 475
  const quietZonePx = Math.max(0, Math.floor((width - barsWidthPx) / 2));
  const barHeightPx = 220;
  const barTop = Math.floor((height - barHeightPx) / 2);
  const barBottom = barTop + barHeightPx;

  const BLACK = 16;
  const WHITE = 235;
  const NEUTRAL_CHROMA = 128;

  const columnIsBlack = new Uint8Array(width);
  for (let x = quietZonePx; x < Math.min(width, quietZonePx + barsWidthPx); x++) {
    const moduleIndex = Math.floor((x - quietZonePx) / moduleWidthPx);
    columnIsBlack[x] = modules[moduleIndex] ? 1 : 0;
  }

  const yPlane = new Uint8Array(width * height).fill(WHITE);
  for (let row = barTop; row < barBottom; row++) {
    const rowStart = row * width;
    for (let x = 0; x < width; x++) {
      if (columnIsBlack[x]) yPlane[rowStart + x] = BLACK;
    }
  }
  const chromaWidth = Math.ceil(width / 2);
  const chromaHeight = Math.ceil(height / 2);
  const uPlane = new Uint8Array(chromaWidth * chromaHeight).fill(NEUTRAL_CHROMA);
  const vPlane = new Uint8Array(chromaWidth * chromaHeight).fill(NEUTRAL_CHROMA);

  mkdirSync(dirname(path), { recursive: true });

  const header = Buffer.from(`YUV4MPEG2 W${width} H${height} F30:1 Ip A1:1 C420jpeg\n`);
  const frameHeader = Buffer.from('FRAME\n');
  const yBuf = Buffer.from(yPlane);
  const uBuf = Buffer.from(uPlane);
  const vBuf = Buffer.from(vPlane);

  const parts: Buffer[] = [header];
  for (let i = 0; i < frames; i++) parts.push(frameHeader, yBuf, uBuf, vBuf);

  writeFileSync(path, Buffer.concat(parts));
}
