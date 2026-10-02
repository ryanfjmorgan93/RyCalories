/**
 * What movement an exercise is, read from its name — pure. No IO, no clock.
 *
 * Two exercises of one movement ("DB Shoulder Press" and "Arnold Press") train a muscle the same
 * way, so a routine that wants variety asks for one of each. A movement is a short key
 * (`movementPattern`); the part of a muscle it reaches is a region (`regionOf`), which is how a
 * routine for the shoulders knows to take a front, a side and a rear exercise before a second front.
 *
 * Names come from three places that spell things differently (the seeded rows, the diagrams and
 * the catalogue), so the rules read words, not whole names, and a handful of names that the dataset
 * gives no hint of are fixed by hand (`OVERRIDES`). A name no rule reads gets the muscle group it
 * was filed under: the honest answer for "not known", never a guess.
 */
import type { MuscleGroup } from './types';

// ---------------------------------------------------------------------------
// Rules

interface Rule {
  pattern: string;
  test: RegExp;
  /** Only for exercises filed under one of these groups. */
  groups?: readonly MuscleGroup[];
  /** Never for exercises filed under one of these groups. */
  not?: readonly MuscleGroup[];
}

const DELT_FILES: readonly MuscleGroup[] = ['shoulders', 'rear delts', 'traps', 'upper back', 'full body', 'other'];

/**
 * First match wins, so the order is the meaning: a rear fly is read before a fly, a leg curl before
 * a curl, a shrug before the calf raise in "Calf-Machine Shoulder Shrug".
 */
const RULES: readonly Rule[] = [
  // Not lifts: they have no place in a routine, and say so.
  { pattern: 'mobility', test: /stretch|cat cow|childs pose|leg swings|torso twists|arm circles|worlds greatest|hip airplane|forward fold|scapular|dead hang|active hang|wall walk|crab walk|inchworm|isometric wipers/ },
  { pattern: 'cardio', test: /\b(running|cycling|assault bike|elliptical|stair climber|treadmill|hiking|swimming|skierg|jump rope|battle ropes?|jumping jack|high knees|burpee|fast feet|lateral shuffle|mountain climber|sprawl|seal jack|plank jack|squat thrust|bear crawl|bear plank|rope climb)\b|^(walking|rowing)$/ },
  { pattern: 'jump', test: /\b(jump|jumps|hop|plyo|explosive|bound)\b|power stairs/ },
  { pattern: 'carry', test: /\bfarmers?\b|\bcarry\b|yoke walk|suitcase/ },
  { pattern: 'strongman', test: /sled (push|drag|walk)|backward walk|\bdrag\b(?! curl)|sandbag|conan|tire flip|\bkeg\b|atlas|circus|log lift|rack delivery|turkish|get up|pirate ships|axle|car deadlift/ },

  // Hinges before anything that says "deadlift" or "swing" in another sense.
  { pattern: 'hinge', test: /deadlift|romanian|\brdl\b|stiff leg|good morning|rack pull|pull through|\bswings?\b/ },
  { pattern: 'olympic', test: /\b(clean|snatch|jerk|thruster)\b|high pull\b/, not: ['traps'] },

  // Arms and wrists.
  { pattern: 'wrist-curl', test: /wrist|finger curl|hand squeeze|plate pinch/ },
  { pattern: 'leg-curl', test: /leg curl|hamstring (curl|slide|walkout)|nordic|glute ham|prone manual hamstring/ },
  { pattern: 'leg-extension', test: /leg extension/ },

  // Shoulders and what hangs off them. Shrugs and rows to the neck first: they are named for two things.
  { pattern: 'shrug', test: /shrug/ },
  { pattern: 'upright-row', test: /upright .*row|high pull\b/ },
  { pattern: 'face-pull', test: /face pull|row to neck/ },
  { pattern: 'rear-row', test: /rear delt (rope )?rows?|rear delt rows/ },
  {
    pattern: 'rear-fly',
    test: /\b(rear|reverse|bent over|back|prone|sled reverse)\b.*\b(fly|flye|flyes|flies|raise|lateral|laterals|pec deck)\b|reverse fly|reverse pec deck|pull apart|snow angel/,
    not: ['quads', 'hamstrings', 'glutes', 'abs', 'calves'],
  },
  { pattern: 'rotation', test: /(external|internal) rotation/ },
  { pattern: 'lateral-raise', test: /\b(lateral|side|laterals)\b.*\braises?\b|\braises?\b.*\b(lateral|side|laterals)\b|\bside laterals?\b|\bdeltoid raise\b/, groups: DELT_FILES },
  { pattern: 'front-raise', test: /\bfront\b.*\braise|\braise\b.*\bfront\b|front delt|scaption|incline shoulder raise/, groups: DELT_FILES },
  { pattern: 'press-vertical', test: /shoulder press|overhead press|military press|arnold press|push press|handstand push|\bohp\b|landmine press/ },
  { pattern: 'press-vertical', test: /press|jammer|handstand|pike|military|arnold/, groups: ['shoulders'] },

  // Chest, triceps and the dip that is both.
  { pattern: 'dip', test: /\bdips?\b/, not: ['abs'] },
  { pattern: 'pushdown', test: /pushdown|pressdown|press down/, groups: ['triceps'] },
  { pattern: 'triceps-kickback', test: /kickback/, groups: ['triceps'] },
  { pattern: 'triceps-extension', test: /extension|crusher|press to chin|tricep press|triceps press|tate press|body up|french|overhead/, groups: ['triceps'] },
  { pattern: 'press-close', test: /close grip|jm press|reverse triceps bench|diamond|bench press|push up|press/, groups: ['triceps'] },
  { pattern: 'fly', test: /\b(fly|flye|flyes|flies)\b|cross over|crossover|pec deck|svend|around the worlds|iron cross/, groups: ['chest'] },
  { pattern: 'press-incline', test: /incline/, groups: ['chest'] },
  { pattern: 'press-decline', test: /decline/, groups: ['chest'] },
  { pattern: 'press-horizontal', test: /press|bench|push up|pushup|floor|neck press/, groups: ['chest'] },

  // Back.
  { pattern: 'pullover', test: /pullover|straight arm/ },
  { pattern: 'pullover', test: /pushdown/, groups: ['lats', 'upper back'] },
  { pattern: 'pulldown', test: /pull ?down/ },
  { pattern: 'pull-up', test: /pull ?ups?\b|chin ?ups?\b|\bchins?\b|muscle up|commando|negative pull/, not: ['abs'] },
  { pattern: 'row', test: /\brows?\b|bench pull/ },

  // Biceps. A curl is read for the part of the muscle it names.
  { pattern: 'preacher-curl', test: /(preacher|spider|concentration).*curl|curl.*(preacher|spider|concentration)/ },
  { pattern: 'hammer-curl', test: /(hammer|zottman|cross body).*curl|curl.*hammer/ },
  { pattern: 'reverse-curl', test: /reverse.*curl/ },
  { pattern: 'incline-curl', test: /incline.*curl|curls? .*incline|flexor incline|prone incline/ },
  { pattern: 'curl', test: /curl/, not: ['neck', 'hamstrings', 'abs'] },

  // Legs.
  { pattern: 'back-extension', test: /back extension|hyperextension|superman|reverse hyper/ },
  { pattern: 'hip-thrust', test: /hip thrust|glute bridge|frog pump|hip lift|hip bridge|hip extension|\bbridge\b/ },
  { pattern: 'plank', test: /plank|rollout|ab wheel|dead bug|bird dog|hollow|\bl sit\b|dragon flag|pallof|fallout/ },
  { pattern: 'glute-kickback', test: /kickback|donkey kick|fire hydrant|\bleg lift\b/ },
  { pattern: 'abduction', test: /abduction|clamshell|lateral walk|monster walk|side lying leg raise/ },
  { pattern: 'adduction', test: /adduction|adductor|copenhagen/ },
  { pattern: 'calf-raise', test: /calf/ },
  { pattern: 'leg-press', test: /leg press|hack squat|belt squat|lying machine squat/ },
  { pattern: 'lunge', test: /lunge|split squat|step up|step down|pistol|shrimp|skater squat|cossack|curtsy|single leg (high )?(box )?squat|one leg|bulgarian/ },
  { pattern: 'squat', test: /squat|wall sit|zercher|jefferson|frankenstein|goblet/ },

  // Core.
  { pattern: 'crunch', test: /crunch|sit up|situp|v up|toe touch|bicycle|air bike|cocoons|elbow to knee|knee to elbow|jackknife|otis up|butt ups|bottoms up/ },
  { pattern: 'leg-raise', test: /leg raise|knee raise|knee tuck|flutter kick|heel tap|captain|hip raise|hanging pike|pull in/ },
  { pattern: 'twist', test: /twist|woodchop|wood chop|side bend|windmill|cable lift|landmine 180/ },
];

/** Names the words above cannot place. The dataset's own steps say what each one is. */
const OVERRIDES: Readonly<Record<string, string>> = {
  'dumbbell raise': 'lateral-raise',
  'power partials': 'lateral-raise',
  crucifix: 'lateral-raise',
  'standing low pulley deltoid raise': 'lateral-raise',
  'alternating deltoid raise': 'front-raise',
  'single dumbbell raise': 'front-raise',
  'straight raises on incline bench': 'front-raise',
  'prone t raise': 'rear-fly',
  'prone y raise': 'rear-fly',
};

/** Movements that are not lifts a routine is built from. */
export const NON_ROUTINE_PATTERNS: ReadonlySet<string> = new Set(['mobility', 'cardio', 'jump', 'carry', 'strongman', 'olympic', 'rotation']);

/** Every key `movementPattern` can return other than a muscle group. */
export const MOVEMENT_PATTERNS: readonly string[] = [
  ...new Set([...RULES.map((r) => r.pattern), ...Object.values(OVERRIDES)]),
];

function normalise(name: string): string {
  return name
    .toLowerCase()
    .replace(/[‘’ʼ`´']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const CACHE_CAP = 5000;
const cache = new Map<string, string>();

/**
 * A short key for the movement an exercise is: 'press-vertical', 'lateral-raise', 'row', 'curl' and
 * so on. An exercise nothing in its name places is its muscle group, which says "not known".
 */
export function movementPattern(name: string, muscleGroup: MuscleGroup): string {
  const key = `${muscleGroup}|${name}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const n = normalise(typeof name === 'string' ? name : '');
  let pattern: string = muscleGroup;
  const override = OVERRIDES[n];
  if (override !== undefined) pattern = override;
  else {
    for (const rule of RULES) {
      if (rule.groups && !rule.groups.includes(muscleGroup)) continue;
      if (rule.not && rule.not.includes(muscleGroup)) continue;
      if (rule.test.test(n)) {
        pattern = rule.pattern;
        break;
      }
    }
  }
  if (cache.size >= CACHE_CAP) cache.clear();
  cache.set(key, pattern);
  return pattern;
}

/** Whether `pattern` names a movement, rather than falling back to a muscle group. */
export function isKnownMovement(pattern: string, muscleGroup: MuscleGroup): boolean {
  return pattern !== muscleGroup;
}

// ---------------------------------------------------------------------------
// Regions

/**
 * Which part of a muscle a movement reaches, as `unit:region`. Shoulders reach front, side and
 * rear; chest upper, mid, fly and lower; and so on. A movement with no region says nothing about
 * which part it trains.
 */
export function regionOf(name: string, muscleGroup: MuscleGroup): string | null {
  const pattern = movementPattern(name, muscleGroup);
  switch (pattern) {
    case 'press-vertical':
    case 'front-raise':
      return 'shoulders:front';
    case 'lateral-raise':
    case 'upright-row':
      return 'shoulders:side';
    case 'rear-fly':
    case 'face-pull':
    case 'rear-row':
      return 'shoulders:rear';
    case 'press-horizontal':
      return 'chest:mid';
    case 'press-incline':
      return 'chest:upper';
    case 'fly':
      return 'chest:fly';
    case 'press-decline':
      return 'chest:lower';
    case 'dip':
      return muscleGroup === 'triceps' ? 'triceps:compound' : 'chest:lower';
    case 'pulldown':
    case 'pull-up':
    case 'pullover':
      return 'back:vertical';
    case 'row':
      return 'back:horizontal';
    case 'shrug':
      return 'back:traps';
    case 'incline-curl':
      return 'biceps:long';
    case 'curl':
    case 'preacher-curl':
      return 'biceps:short';
    case 'hammer-curl':
    case 'reverse-curl':
      return muscleGroup === 'forearms' ? 'forearms:wrist' : 'biceps:brachialis';
    case 'triceps-extension':
      return 'triceps:long';
    case 'pushdown':
    case 'triceps-kickback':
      return 'triceps:lateral';
    case 'press-close':
      return 'triceps:compound';
    case 'squat':
    case 'leg-press':
      return 'quads:bilateral';
    case 'lunge':
      return 'quads:single';
    case 'leg-extension':
      return 'quads:isolation';
    case 'hinge':
      return 'hamstrings:hinge';
    case 'leg-curl':
      return 'hamstrings:flexion';
    case 'hip-thrust':
      return 'glutes:thrust';
    case 'glute-kickback':
    case 'abduction':
      return 'glutes:abduction';
    case 'adduction':
      return 'adductors:adduction';
    case 'calf-raise':
      return /\bseated\b|bent knee/.test(normalise(name)) ? 'calves:seated' : 'calves:standing';
    case 'crunch':
      return 'abs:crunch';
    case 'leg-raise':
      return 'abs:raise';
    case 'plank':
      return 'abs:brace';
    case 'twist':
      return 'abs:twist';
    case 'back-extension':
      return 'lowerback:extension';
    case 'wrist-curl':
      return 'forearms:wrist';
    default:
      return null;
  }
}

/** What a muscle's work spans, in the order a routine takes it. The rear delt is shared: the shoulders and the upper back both reach it. */
export const MUSCLE_REGIONS: Readonly<Partial<Record<MuscleGroup, readonly string[]>>> = {
  shoulders: ['shoulders:front', 'shoulders:side', 'shoulders:rear'],
  'rear delts': ['shoulders:rear'],
  chest: ['chest:mid', 'chest:upper', 'chest:fly', 'chest:lower'],
  lats: ['back:vertical', 'back:horizontal'],
  'upper back': ['back:horizontal', 'shoulders:rear', 'back:traps'],
  traps: ['back:traps'],
  biceps: ['biceps:long', 'biceps:short', 'biceps:brachialis'],
  triceps: ['triceps:long', 'triceps:lateral', 'triceps:compound'],
  quads: ['quads:bilateral', 'quads:single', 'quads:isolation'],
  hamstrings: ['hamstrings:hinge', 'hamstrings:flexion'],
  glutes: ['glutes:thrust', 'glutes:abduction'],
  calves: ['calves:standing', 'calves:seated'],
  abs: ['abs:crunch', 'abs:raise', 'abs:brace', 'abs:twist'],
  'lower back': ['lowerback:extension'],
  adductors: ['adductors:adduction'],
  forearms: ['forearms:wrist'],
};

/** A region in words: 'side delts', 'upper chest', 'long head'. */
export const REGION_LABELS: Readonly<Record<string, string>> = {
  'shoulders:front': 'front delts',
  'shoulders:side': 'side delts',
  'shoulders:rear': 'rear delts',
  'chest:mid': 'mid chest',
  'chest:upper': 'upper chest',
  'chest:fly': 'chest fly',
  'chest:lower': 'lower chest',
  'back:vertical': 'vertical pull',
  'back:horizontal': 'horizontal pull',
  'back:traps': 'upper back and traps',
  'biceps:long': 'biceps long head',
  'biceps:short': 'biceps short head',
  'biceps:brachialis': 'brachialis',
  'triceps:long': 'triceps long head',
  'triceps:lateral': 'triceps lateral head',
  'triceps:compound': 'triceps compound',
  'quads:bilateral': 'quads, both legs',
  'quads:single': 'quads, one leg',
  'quads:isolation': 'quads, isolation',
  'hamstrings:hinge': 'hamstrings, hinge',
  'hamstrings:flexion': 'hamstrings, knee flexion',
  'glutes:thrust': 'glutes, thrust',
  'glutes:abduction': 'glutes, abduction',
  'calves:standing': 'standing calves',
  'calves:seated': 'seated calves',
  'abs:crunch': 'abs, crunch',
  'abs:raise': 'abs, leg raise',
  'abs:brace': 'abs, brace',
  'abs:twist': 'abs, rotation',
  'lowerback:extension': 'lower back',
  'adductors:adduction': 'adductors',
  'forearms:wrist': 'forearms',
};

/** A movement in words: 'lateral raise', 'rear fly'. */
export const PATTERN_LABELS: Readonly<Record<string, string>> = {
  'press-vertical': 'vertical press',
  'press-horizontal': 'flat press',
  'press-incline': 'incline press',
  'press-decline': 'decline press',
  'press-close': 'close-grip press',
  dip: 'dip',
  fly: 'fly',
  'lateral-raise': 'lateral raise',
  'front-raise': 'front raise',
  'upright-row': 'upright row',
  'rear-fly': 'rear fly',
  'face-pull': 'face pull',
  'rear-row': 'rear delt row',
  pulldown: 'pulldown',
  'pull-up': 'pull-up',
  pullover: 'pullover',
  row: 'row',
  shrug: 'shrug',
  curl: 'curl',
  'incline-curl': 'incline curl',
  'preacher-curl': 'preacher curl',
  'hammer-curl': 'hammer curl',
  'reverse-curl': 'reverse curl',
  'wrist-curl': 'wrist curl',
  'triceps-extension': 'triceps extension',
  pushdown: 'pushdown',
  'triceps-kickback': 'triceps kickback',
  squat: 'squat',
  'leg-press': 'leg press',
  lunge: 'lunge',
  'leg-extension': 'leg extension',
  hinge: 'hinge',
  'leg-curl': 'leg curl',
  'back-extension': 'back extension',
  'hip-thrust': 'hip thrust',
  'glute-kickback': 'glute kickback',
  abduction: 'abduction',
  adduction: 'adduction',
  'calf-raise': 'calf raise',
  crunch: 'crunch',
  'leg-raise': 'leg raise',
  plank: 'brace',
  twist: 'rotation',
};

/** The movement's words, or the key itself when it has none (a muscle group names itself). */
export function patternLabel(pattern: string): string {
  return PATTERN_LABELS[pattern] ?? pattern;
}
