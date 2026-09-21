/**
 * Pure geometry and colour for the loaded-barbell diagram in `PlateSheet`, built from the same
 * `perSide` list `plates.ts` already computes (heaviest first — see `platesPerSide`). No DOM, no
 * SVG string-building: this returns plain numbers and colours; the component turns them into
 * `<rect>`/`<text>` elements. Keeping the size maths here (rather than in the component) is what
 * makes it directly testable.
 */

// ---------------------------------------------------------------------------------------------
// Plate size -> real-world diameter
//
// Competition-CALIBRATED plates keep 25/20/15 kg all at one 450 mm diameter on purpose, so a
// calibrated bar sits at the same height regardless of load. The plates on an ordinary training
// bar are not calibrated — they're plain cast iron or urethane discs that genuinely shrink as
// they get lighter, and that shrink is the cue a lifter's eye actually reads off a stack at a
// glance. These are approximate diameters for a typical TRAINING set (not any one manufacturer's
// spec sheet); they only need to be realistic and in the right order, since they exist purely to
// rank and scale plates relative to each other.
// ---------------------------------------------------------------------------------------------

const REAL_DIAMETER_MM: [kg: number, mm: number][] = [
  [1.25, 160],
  [2.5, 190],
  [5, 230],
  [10, 310],
  [15, 350],
  [20, 400],
  [25, 450],
];

/** Bounds an out-of-table weight is clamped into, so an unusual plate still lands somewhere
 *  sensible instead of running away to an absurd or negative size. */
const REAL_MIN_MM = 90;
const REAL_MAX_MM = 480;

/**
 * Linear interpolation across `points` (sorted ascending by x). Beyond either end, extrapolates
 * using the nearest segment's slope rather than flattening immediately, so a plate just outside
 * the table still lands in a sensible place relative to its neighbours.
 */
function interpolate(x: number, points: [number, number][]): number {
  const [x0, y0] = points[0];
  const [xn, yn] = points[points.length - 1];
  if (x <= x0) {
    const [x1, y1] = points[1];
    return y0 + ((y1 - y0) / (x1 - x0)) * (x - x0);
  }
  if (x >= xn) {
    const [xPrev, yPrev] = points[points.length - 2];
    return yn + ((yn - yPrev) / (xn - xPrev)) * (x - xn);
  }
  for (let i = 0; i < points.length - 1; i++) {
    const [xa, ya] = points[i];
    const [xb, yb] = points[i + 1];
    if (x >= xa && x <= xb) return ya + ((yb - ya) / (xb - xa)) * (x - xa);
  }
  return yn; // unreachable — x is within [x0, xn] and the loop above covers every segment.
}

/**
 * Real-world reference diameter for a plate of `kg`, in mm: table lookup for the seven standard
 * sizes, interpolated/extrapolated for anything else, clamped to [REAL_MIN_MM, REAL_MAX_MM].
 *
 * Monotonic in kg — a heavier plate's diameter is never smaller than a lighter plate's — because
 * REAL_DIAMETER_MM is itself monotonic (each weight strictly increasing in mm), interpolating or
 * extrapolating a monotonic sequence with a positive slope stays monotonic, and clamping a
 * monotonic function to a fixed floor/ceiling can only ever flatten it, never reverse it.
 */
export function realPlateDiameterMm(kg: number): number {
  if (!Number.isFinite(kg) || kg <= 0) return REAL_MIN_MM;
  return Math.min(REAL_MAX_MM, Math.max(REAL_MIN_MM, interpolate(kg, REAL_DIAMETER_MM)));
}

// ---------------------------------------------------------------------------------------------
// Real diameter -> drawn size
//
// Drawn to scale 1:1 with the mm table above, a single 25 kg plate would be roughly three times
// as tall as it is wide (450 mm diameter against a ~50 mm sleeve and a handful of plate
// thicknesses) — a portrait sliver, not "a horizontal bar with plates on it". Height is rescaled
// into a fixed, compact [DRAWN_HEIGHT_MIN, DRAWN_HEIGHT_MAX] band instead: still driven entirely
// by realPlateDiameterMm (so the ordering and the fact that a 25 reads taller than a 20, which
// reads taller than a 15, is unchanged and still real), just compressed enough that the bar reads
// as a horizontal diagram rather than a to-scale close-up of one plate.
// ---------------------------------------------------------------------------------------------

const DRAWN_HEIGHT_MIN = 30;
const DRAWN_HEIGHT_MAX = 96;
const DRAWN_THICKNESS_MIN = 12;
const DRAWN_THICKNESS_MAX = 26;

function rescale(v: number, fromMin: number, fromMax: number, toMin: number, toMax: number): number {
  const t = (v - fromMin) / (fromMax - fromMin);
  return toMin + t * (toMax - toMin);
}

/**
 * Drawn height for a plate of `kg`, in SVG diagram units — proportional to realPlateDiameterMm,
 * rescaled into a fixed band. Monotonic in kg for the same reason realPlateDiameterMm is: a
 * rescale into a fixed [min, max] range preserves the ordering of whatever it's given.
 */
export function drawnPlateHeight(kg: number): number {
  return rescale(realPlateDiameterMm(kg), REAL_MIN_MM, REAL_MAX_MM, DRAWN_HEIGHT_MIN, DRAWN_HEIGHT_MAX);
}

/**
 * Drawn thickness for a plate of `kg`. Varies with the same real-diameter ordering as the height,
 * just compressed into a much narrower band — height is what reads at a glance, thickness is a
 * secondary cue, not the primary way a plate reads as "bigger".
 */
export function drawnPlateThickness(kg: number): number {
  return rescale(realPlateDiameterMm(kg), REAL_MIN_MM, REAL_MAX_MM, DRAWN_THICKNESS_MIN, DRAWN_THICKNESS_MAX);
}

// ---------------------------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------------------------

/**
 * Standard gym plate colours (25 red, 20 blue, 15 yellow, 10 green, 5 white, 2.5 red, 1.25
 * chrome), muted so they sit inside this app's dark-first palette rather than fighting it. Purely
 * decorative: every plate is labelled with its own weight regardless, so nothing here is the only
 * way to tell two plates apart. A plate size with no standard colour (a custom set) gets a
 * neutral grey rather than a guessed one.
 */
const PLATE_COLOR: Record<number, string> = {
  25: '#b3453f',
  20: '#3f6fa8',
  15: '#c2a23c',
  10: '#4c9a5b',
  5: '#c5c6cc',
  2.5: '#b3453f',
  1.25: '#8b8f98',
};
const FALLBACK_PLATE_COLOR = '#6b7280';

export function plateColor(kg: number): string {
  return PLATE_COLOR[kg] ?? FALLBACK_PLATE_COLOR;
}

// ---------------------------------------------------------------------------------------------
// Full diagram geometry
// ---------------------------------------------------------------------------------------------

export interface PlateBlock {
  kg: number;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

export interface DiagramPart {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlateDiagramSpec {
  /** viewBox width/height, in diagram units. */
  width: number;
  height: number;
  /** y of the bar's centreline — every part is drawn symmetrically around this. */
  barY: number;
  /** y for every plate's weight label (one shared row, so labels line up left to right). */
  labelY: number;
  /** The bar continuing in towards the lifter, cut off at the diagram's edge. */
  shaft: DiagramPart;
  /** Where the plates actually sit. */
  sleeve: DiagramPart;
  /** The collar/clip holding the stack on, flush against the outermost (lightest) plate. */
  clip: DiagramPart;
  /** Heaviest first — inboard (against the sleeve) to outboard (against the clip), same order as
   *  `perSide`. Empty for "bar only". */
  plates: PlateBlock[];
}

const SHAFT_LEN = 55;
const SLEEVE_LEN = 50;
const CLIP_LEN = 16;
const PLATE_GAP = 5;
const LEAD_MARGIN = 8;
const TRAIL_MARGIN = 12;

const SHAFT_HEIGHT = 16;
const SLEEVE_HEIGHT = 34;
const CLIP_HEIGHT = 30;

const LABEL_SPACE = 26;
const BOTTOM_MARGIN = 10;

/**
 * Lay out one side of a loaded barbell: shaft, sleeve, the plates in `perSide` heaviest-to-
 * lightest (left = inboard = against the sleeve, right = outboard = against the clip — this is
 * both the order real plates go on in and the order `platesPerSide` already returns), and the
 * clip. The overall height is fixed at DRAWN_HEIGHT_MAX regardless of which plates are actually
 * present, so the bar's centreline sits at the same place every time the sheet opens — only the
 * plates grow or shrink around it.
 */
export function buildPlateDiagram(perSide: number[]): PlateDiagramSpec {
  const height = LABEL_SPACE + DRAWN_HEIGHT_MAX + BOTTOM_MARGIN;
  const barY = LABEL_SPACE + DRAWN_HEIGHT_MAX / 2;

  let x = LEAD_MARGIN;
  const shaft: DiagramPart = { x, y: barY - SHAFT_HEIGHT / 2, width: SHAFT_LEN, height: SHAFT_HEIGHT };
  x += SHAFT_LEN;
  const sleeve: DiagramPart = { x, y: barY - SLEEVE_HEIGHT / 2, width: SLEEVE_LEN, height: SLEEVE_HEIGHT };
  x += SLEEVE_LEN;

  const plates: PlateBlock[] = perSide.map((kg) => {
    const width = drawnPlateThickness(kg);
    const plateHeight = drawnPlateHeight(kg);
    const block: PlateBlock = { kg, x, y: barY - plateHeight / 2, width, height: plateHeight, color: plateColor(kg) };
    x += width + PLATE_GAP;
    return block;
  });
  if (perSide.length > 0) x -= PLATE_GAP; // no trailing gap before the clip

  const clip: DiagramPart = { x, y: barY - CLIP_HEIGHT / 2, width: CLIP_LEN, height: CLIP_HEIGHT };
  x += CLIP_LEN + TRAIL_MARGIN;

  return { width: x, height, barY, labelY: LABEL_SPACE - 8, shaft, sleeve, clip, plates };
}
