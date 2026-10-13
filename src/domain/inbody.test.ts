/**
 * The InBody parser, against synthetic files only (nothing here is anyone's real scan). The two
 * fixture files under e2e/fixtures/inbody are shared with the Playwright spec, so the unit test and
 * the browser test read exactly the same bytes.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodeInbodyBytes, normaliseHeader, parseInbodyCsv, scanDeltas, type ParsedScan } from './inbody';

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`../../e2e/fixtures/inbody/${name}`, import.meta.url)), 'utf8');

const dates = (text: string) => parseInbodyCsv(text).scans.map((s) => s.date);

describe('headers', () => {
  it('reduces case, spacing, punctuation and brackets to words and a unit', () => {
    expect(normaliseHeader('Percent Body Fat(%)')).toEqual({ words: 'percent body fat', unit: 'pct' });
    expect(normaliseHeader('﻿"Weight (lbs)"'.replace(/"/g, ''))).toEqual({ words: 'weight', unit: 'lb' });
    expect(normaliseHeader('SkeletalMuscleMass_kg')).toEqual({ words: 'skeletal muscle mass', unit: 'kg' });
    expect(normaliseHeader('ECW/TBW')).toEqual({ words: 'ecw tbw', unit: null });
    expect(normaliseHeader('InBody Score')).toEqual({ words: 'inbody score', unit: null });
    expect(normaliseHeader('Body Fat %')).toEqual({ words: 'body fat', unit: 'pct' });
    expect(normaliseHeader('Visceral Fat Level(Level)').words).toBe('visceral fat level');
  });
});

describe('the 44-column file', () => {
  const parsed = parseInbodyCsv(fixture('inbody-44-column.csv'));

  it('starts with a byte-order mark, and the parser reads past it', () => {
    expect(fixture('inbody-44-column.csv').charCodeAt(0)).toBe(0xfeff);
    expect(fixture('inbody-44-column.csv').split('\r\n')[0].split(',')).toHaveLength(44);
    expect(parsed.scans).toHaveLength(4);
    expect(parsed.skipped).toEqual([]);
    expect(parsed.unitsNote).toBeUndefined();
    expect(parsed.dateNote).toBeUndefined();
  });

  it('reads the whole-body measures, oldest scan first', () => {
    expect(parsed.scans.map((s) => s.date)).toEqual(['2026-05-05', '2026-06-02', '2026-07-07', '2026-08-04']);
    expect(parsed.scans[0]).toMatchObject({
      source: 'csv',
      weightKg: 79.8,
      skeletalMuscleKg: 35.2,
      bodyFatKg: 13.9,
      bodyFatPct: 17.4,
      leanMassKg: 65.9,
      totalBodyWaterL: 48.1,
      bmrKcal: 1812,
      visceralFatLevel: 5,
      inbodyScore: 76,
      ecwRatio: 0.384,
      phaseAngle: 6.4,
    });
  });

  it('reads segmental lean and fat per limb, and ignores the percentage columns and the rest', () => {
    expect(parsed.scans[0].segmentalLeanKg).toEqual({ rightArm: 3.4, leftArm: 3.4, trunk: 28.9, rightLeg: 10.2, leftLeg: 10.1 });
    expect(parsed.scans[0].segmentalFatKg).toEqual({ rightArm: 0.6, leftArm: 0.6, trunk: 6.1, rightLeg: 2.1, leftLeg: 2.0 });
    expect(Object.keys(parsed.scans[0]).sort()).not.toContain('targetWeight');
  });

  it('keeps the time of day, as written, and treats "-" as missing rather than zero', () => {
    const t = new Date(parsed.scans[0].takenAt!);
    expect([t.getHours(), t.getMinutes(), t.getSeconds()]).toEqual([7, 12, 30]);
    const last = parsed.scans[3];
    expect(last).not.toHaveProperty('visceralFatLevel');
    expect(last).not.toHaveProperty('phaseAngle');
    expect(last.weightKg).toBe(81.5);
  });
});

describe('a short phone-style export', () => {
  const parsed = parseInbodyCsv(fixture('inbody-phone.csv'));

  it('reads day-first dates with a time and sorts them oldest first', () => {
    expect(parsed.scans.map((s) => s.date)).toEqual(['2026-05-05', '2026-06-02', '2026-07-07', '2026-08-04']);
    expect(parsed.scans[3]).toMatchObject({ weightKg: 81.5, skeletalMuscleKg: 36.4, bodyFatKg: 14.1, bodyFatPct: 17.3 });
    expect(parsed.scans[3]).not.toHaveProperty('segmentalLeanKg');
    expect(parsed.unitsNote).toBeUndefined();
  });

  it('says which way round it read the ambiguous dates', () => {
    expect(parsed.dateNote).toBe('Dates like 04/08/2026 were read day first.');
  });
});

describe('dates', () => {
  const one = (cell: string) => parseInbodyCsv(`Date,Weight(kg)\n${cell},80`);

  it('reads yyyyMMddHHmmss, yyyyMMddHHmm and yyyyMMdd', () => {
    expect(dates('Date,Weight(kg)\n20260804072045,80')).toEqual(['2026-08-04']);
    expect(dates('Date,Weight(kg)\n202608040720,80')).toEqual(['2026-08-04']);
    expect(dates('Date,Weight(kg)\n20260804,80')).toEqual(['2026-08-04']);
    expect(one('20260804072045').scans[0].takenAt).toBeDefined();
    expect(one('20260804').scans[0].takenAt).toBeUndefined();
  });

  it('reads yyyy.MM.dd, ISO with or without a zone, and yyyy/MM/dd', () => {
    expect(dates('Date,Weight(kg)\n2026.08.04 07:20:45,80')).toEqual(['2026-08-04']);
    expect(dates('Date,Weight(kg)\n2026-08-04T07:20:45Z,80')).toEqual(['2026-08-04']);
    expect(dates('Date,Weight(kg)\n2026-08-04T07:20:45.123+01:00,80')).toEqual(['2026-08-04']);
    expect(dates('Date,Weight(kg)\n2026/8/4,80')).toEqual(['2026-08-04']);
  });

  it('takes the wall-clock time as written, so a late-evening scan stays on its own day', () => {
    const scan = one('2026-08-04T23:50:00Z').scans[0];
    expect(scan.date).toBe('2026-08-04');
  });

  it('reads written months, and 12-hour times', () => {
    expect(dates('Date,Weight(kg)\n4 Aug 2026 07:20,80')).toEqual(['2026-08-04']);
    expect(dates('Date,Weight(kg)\n"August 4, 2026",80')).toEqual(['2026-08-04']);
    const t = new Date(one('2026-08-04 07:20 PM').scans[0].takenAt!);
    expect(t.getHours()).toBe(19);
  });

  it('reads dd.MM.yyyy and two-digit years as day first', () => {
    expect(dates('Date,Weight(kg)\n04.08.2026,80')).toEqual(['2026-08-04']);
    expect(dates('Date,Weight(kg)\n04/08/26,80')).toEqual(['2026-08-04']);
  });

  it('reads 03/04/2024 day first when nothing in the file says otherwise, and says so', () => {
    const p = parseInbodyCsv('Date,Weight(kg)\n03/04/2024,80\n05/06/2024,81');
    expect(p.scans.map((s) => s.date)).toEqual(['2024-04-03', '2024-06-05']);
    expect(p.dateNote).toBe('Dates like 03/04/2024 were read day first.');
  });

  it('reads the whole file month first when another date proves it, and says so', () => {
    const p = parseInbodyCsv('Date,Weight(kg)\n03/04/2024,80\n03/25/2024,81');
    expect(p.scans.map((s) => s.date)).toEqual(['2024-03-04', '2024-03-25']);
    expect(p.dateNote).toMatch(/read month first/);
  });

  it('reads the whole file day first when another date proves it', () => {
    const p = parseInbodyCsv('Date,Weight(kg)\n03/04/2024,80\n25/03/2024,81');
    expect(p.scans.map((s) => s.date)).toEqual(['2024-03-25', '2024-04-03']);
    expect(p.dateNote).toMatch(/day first/);
  });

  it('has nothing to say about a date that cannot be read either way round', () => {
    const p = parseInbodyCsv('Date,Weight(kg)\n05/05/2024,80\n25/03/2024,81');
    expect(p.dateNote).toBeUndefined();
  });

  it('skips an impossible date, naming the row and what it said', () => {
    const p = parseInbodyCsv('Date,Weight(kg)\n31/02/2024,80\nlast week,81\n2024-03-05,82');
    expect(p.scans.map((s) => s.date)).toEqual(['2024-03-05']);
    expect(p.skipped).toEqual([
      { row: 2, reason: 'Date "31/02/2024" is not one I can read' },
      { row: 3, reason: 'Date "last week" is not one I can read' },
    ]);
  });

  it('does not take a date of birth for the date of the scan', () => {
    const p = parseInbodyCsv('Date of Birth,Test Date,Weight(kg)\n1990-01-01,2026-08-04,80');
    expect(p.scans.map((s) => s.date)).toEqual(['2026-08-04']);
    expect(parseInbodyCsv('Date of Birth,Weight(kg)\n1990-01-01,80').scans).toEqual([]);
  });

  it('joins a separate time column to the date', () => {
    const p = parseInbodyCsv('Date,Time,Weight(kg)\n2026-08-04,07:20,80');
    expect(new Date(p.scans[0].takenAt!).getHours()).toBe(7);
  });
});

describe('units', () => {
  it('converts pounds named in the header to kilograms and says so', () => {
    const p = parseInbodyCsv('Date,Weight (lb),Skeletal Muscle Mass (lb),Percent Body Fat (%)\n2026-08-04,180,80,17.3');
    expect(p.scans[0].weightKg).toBe(81.65);
    expect(p.scans[0].skeletalMuscleKg).toBe(36.29);
    expect(p.scans[0].bodyFatPct).toBe(17.3);
    expect(p.unitsNote).toBe('Weights converted from pounds to kilograms.');
  });

  it('converts pounds named in a units column, row by row', () => {
    const p = parseInbodyCsv('Date,Weight,Unit\n2026-08-04,180,lbs\n2026-08-05,82,kg');
    expect(p.scans.map((s) => s.weightKg)).toEqual([81.65, 82]);
    expect(p.unitsNote).toBe('Weights converted from pounds to kilograms.');
  });

  it('converts segmental masses and body water in a pounds file', () => {
    const p = parseInbodyCsv('Date,Weight(lbs),Total Body Water(lbs),Right Arm Lean Mass(lbs)\n2026-08-04,180,106,7.5');
    expect(p.scans[0].totalBodyWaterL).toBe(48.08);
    expect(p.scans[0].segmentalLeanKg).toEqual({ rightArm: 3.4 });
  });

  it('reads a file with no units as kilograms and names the columns it assumed for', () => {
    const p = parseInbodyCsv('Date,Weight,Skeletal Muscle Mass\n2026-08-04,81.5,36.4');
    expect(p.scans[0].weightKg).toBe(81.5);
    expect(p.unitsNote).toBe('No unit given for Weight, Skeletal Muscle Mass; read as kilograms.');
  });

  it('reads a bare "Body Fat" as kilograms with a kg unit, and as a percentage with a % unit or none', () => {
    expect(parseInbodyCsv('Date,Body Fat (kg)\n2026-08-04,14.1').scans[0]).toMatchObject({ bodyFatKg: 14.1 });
    expect(parseInbodyCsv('Date,Body Fat %\n2026-08-04,17.3').scans[0]).toMatchObject({ bodyFatPct: 17.3 });
    const bare = parseInbodyCsv('Date,Weight(kg),Body Fat\n2026-08-04,81.5,17.3');
    expect(bare.scans[0]).toMatchObject({ bodyFatPct: 17.3 });
    expect(bare.unitsNote).toBe('"Body Fat" has no unit; read as a percentage.');
  });

  it('turns an ECW ratio written as a percentage into a ratio', () => {
    expect(parseInbodyCsv('Date,ECW/TBW\n2026-08-04,38.4').scans[0].ecwRatio).toBe(0.384);
    expect(parseInbodyCsv('Date,ECW/TBW\n2026-08-04,0.384').scans[0].ecwRatio).toBe(0.384);
  });

  it('ignores visceral fat area, which is a different measure from the level', () => {
    const p = parseInbodyCsv('Date,Weight(kg),Visceral Fat Area(cm2),Visceral Fat (cm²)\n2026-08-04,81.5,64.1,64.1');
    expect(p.scans[0]).not.toHaveProperty('visceralFatLevel');
  });
});

describe('missing and implausible values', () => {
  it('treats empty, "-", "n/a" and unreadable cells as missing, never zero', () => {
    const p = parseInbodyCsv('Date,Weight(kg),Skeletal Muscle Mass(kg),Body Fat Mass(kg),Percent Body Fat(%),BMR\n2026-08-04,81.5,-,,n/a,abc');
    expect(p.scans[0]).toEqual({ date: '2026-08-04', source: 'csv', weightKg: 81.5 });
  });

  it('drops a value no body can have, keeps the rest of the row, and skips a row left with nothing', () => {
    const p = parseInbodyCsv('Date,Weight(kg),Percent Body Fat(%)\n2026-08-04,9999,17.3\n2026-08-05,0,0');
    expect(p.scans).toEqual([{ date: '2026-08-04', source: 'csv', bodyFatPct: 17.3 }]);
    expect(p.skipped).toEqual([{ row: 3, reason: 'No readable measurements' }]);
  });

  it('reads thousands separators and decimal commas', () => {
    const p = parseInbodyCsv('Date,Weight(kg),Basal Metabolic Rate(kcal)\n2026-08-04,"81,5","1,840"');
    expect(p.scans[0]).toMatchObject({ weightKg: 81.5, bmrKcal: 1840 });
  });

  describe('a comma group is a decimal point or a thousands separator depending on the number and the file', () => {
    it('reads a leading "0," as a decimal, whatever else the file does: an ECW ratio of 0,385 is not 385', () => {
      const alone = parseInbodyCsv('Date,Weight(kg),ECW/TBW\n2026-08-04,81.5,"0,385"');
      expect(alone.scans[0]).toMatchObject({ weightKg: 81.5, ecwRatio: 0.385 });
      // Nor in a file that writes its thousands with commas.
      const dotFile = parseInbodyCsv('Date,Basal Metabolic Rate(kcal),ECW/TBW\n2026-08-04,"1,840","0,385"');
      expect(dotFile.scans[0]).toMatchObject({ bmrKcal: 1840, ecwRatio: 0.385 });
    });

    it('reads 81,250 as 81.25 kg in a decimal-comma file, because 81250 is no body weight', () => {
      const p = parseInbodyCsv('Datum;Date;Weight(kg);Skeletal Muscle Mass(kg);ECW/TBW\nx;04.08.2026;81,250;36,4;0,385\nx;05.08.2026;81,5;36,3;0,391');
      expect(p.scans).toEqual([
        { date: '2026-08-04', source: 'csv', weightKg: 81.25, skeletalMuscleKg: 36.4, ecwRatio: 0.385 },
        { date: '2026-08-05', source: 'csv', weightKg: 81.5, skeletalMuscleKg: 36.3, ecwRatio: 0.391 },
      ]);
      expect(p.skipped).toEqual([]);
    });

    it('still reads 1,250 as a thousand two hundred and fifty kcal in a file that writes decimals with a dot', () => {
      const p = parseInbodyCsv('Date,Weight(kg),Basal Metabolic Rate(kcal)\n2026-08-04,81.5,"1,250"\n2026-08-05,81.2,"1,840"');
      expect(p.scans.map((s) => s.bmrKcal)).toEqual([1250, 1840]);
    });

    it('keeps a BMR with a thousands comma in a decimal-comma file, because 1.84 kcal is no metabolism either', () => {
      const p = parseInbodyCsv('Datum;Date;Weight(kg);Basal Metabolic Rate(kcal)\nx;04.08.2026;81,5;1,840');
      expect(p.scans[0]).toMatchObject({ weightKg: 81.5, bmrKcal: 1840 });
    });

    it('drops a number that is no reading either way rather than guessing', () => {
      // 81,250 in a file with no decimal comma anywhere reads as 81250 (thousands), which no body has.
      const p = parseInbodyCsv('Date,Weight(kg),Percent Body Fat(%)\n2026-08-04,"81,250",17');
      expect(p.scans[0]).toEqual({ date: '2026-08-04', source: 'csv', bodyFatPct: 17 });
    });

    it('reads several groups and a fraction as thousands', () => {
      const p = parseInbodyCsv('Date,Basal Metabolic Rate(kJ)\n2026-08-04,"7,700.5"');
      expect(p.scans[0].bmrKcal).toBe(Math.round(7700.5 / 4.184));
    });
  });

  it('takes a number with a unit written in the cell', () => {
    const p = parseInbodyCsv('Date,Weight,Percent Body Fat\n2026-08-04,81.5 kg,17.3 %');
    expect(p.scans[0]).toMatchObject({ weightKg: 81.5, bodyFatPct: 17.3 });
  });
});

describe('duplicate dates', () => {
  it('keeps the later scan of the day, whichever row it is on, and reports the other', () => {
    const p = parseInbodyCsv('Date,Weight(kg)\n2026-08-04 18:00,82\n2026-08-04 07:00,81');
    expect(p.scans).toHaveLength(1);
    expect(p.scans[0].weightKg).toBe(82);
    expect(p.skipped).toEqual([{ row: 3, reason: 'Same date as row 2; the later scan of the day is kept' }]);
  });

  it('keeps the last row for a date when there are no times', () => {
    const p = parseInbodyCsv('Date,Weight(kg)\n2026-08-04,81\n2026-08-04,82\n2026-08-05,83');
    expect(p.scans.map((s) => s.weightKg)).toEqual([82, 83]);
    expect(p.skipped).toEqual([{ row: 2, reason: 'Same date as row 3; the last row for a date is kept' }]);
  });

  it('does not merge the fields of two scans on one date', () => {
    const p = parseInbodyCsv('Date,Weight(kg),Skeletal Muscle Mass(kg)\n2026-08-04,81,36\n2026-08-04,82,-');
    expect(p.scans).toEqual([{ date: '2026-08-04', source: 'csv', weightKg: 82 }]);
  });
});

describe('layout', () => {
  it('ignores title lines above the header, blank lines, summary rows and unknown columns', () => {
    const text = ['InBody export', 'Exported 2026-08-05', '', 'ID,Gender,Date,Weight(kg),Favourite colour', 'A1,M,2026-08-04,81.5,blue', '', 'Average,,,81.5,', ''].join('\n');
    const p = parseInbodyCsv(text);
    expect(p.scans).toEqual([{ date: '2026-08-04', source: 'csv', weightKg: 81.5 }]);
    expect(p.skipped).toEqual([{ row: 7, reason: 'No date' }]);
  });

  it('reads semicolons with decimal commas', () => {
    const p = parseInbodyCsv('Datum;Date;Weight(kg);Skeletal Muscle Mass(kg)\nx;04.08.2026;81,5;36,4\nx;05.08.2026;81,0;-');
    expect(p.scans).toEqual([
      { date: '2026-08-04', source: 'csv', weightKg: 81.5, skeletalMuscleKg: 36.4 },
      { date: '2026-08-05', source: 'csv', weightKg: 81 },
    ]);
  });

  it('reads tabs, pipes and an Excel "sep=" line', () => {
    expect(parseInbodyCsv('Date\tWeight(kg)\n2026-08-04\t81.5').scans[0].weightKg).toBe(81.5);
    expect(parseInbodyCsv('Date|Weight(kg)\n2026-08-04|81.5').scans[0].weightKg).toBe(81.5);
    const p = parseInbodyCsv('sep=;\nDate;Weight(kg)\n2026-08-04;81,5');
    expect(p.scans[0].weightKg).toBe(81.5);
  });

  it('counts rows from the first line of the file, past a sep line', () => {
    const p = parseInbodyCsv('sep=,\nDate,Weight(kg)\nnope,81.5');
    expect(p.skipped[0].row).toBe(3);
  });

  it('reads a file with one column per scan', () => {
    const p = parseInbodyCsv('Date,2026-07-07,2026-08-04\nWeight(kg),81.1,81.5\nSkeletal Muscle Mass(kg),36.0,36.4');
    expect(p.scans).toEqual([
      { date: '2026-07-07', source: 'csv', weightKg: 81.1, skeletalMuscleKg: 36 },
      { date: '2026-08-04', source: 'csv', weightKg: 81.5, skeletalMuscleKg: 36.4 },
    ]);
  });

  it('survives CRLF, quoted headers and a trailing delimiter', () => {
    const p = parseInbodyCsv('"Date","Weight(kg)",\r\n"2026-08-04","81.5",\r\n');
    expect(p.scans[0].weightKg).toBe(81.5);
  });

  it('says what the file looked like when it finds no header, and for an empty file', () => {
    const none = parseInbodyCsv('Name,Colour\nA,blue');
    expect(none.scans).toEqual([]);
    expect(none.skipped).toEqual([{ row: 0, reason: 'No date column and measures found. First line: Name, Colour' }]);
    expect(parseInbodyCsv('')).toEqual({ scans: [], skipped: [{ row: 0, reason: 'The file is empty' }] });
    expect(parseInbodyCsv('Date,Colour\n2026-08-04,blue').scans).toEqual([]);
  });
});

describe('header spellings', () => {
  it('matches the names InBody and its phone app use, case and punctuation aside', () => {
    const header = ['TEST DATE/TIME', 'weight', 'smm', 'BFM', 'PBF', 'Lean Body Mass', 'tbw', 'Basal Metabolic Rate', 'VFL', 'ecw tbw', 'InBody Points', 'Phase Angle Whole Body 50kHz'];
    const row = ['2026-08-04 07:20', '81.5', '36.4', '14.1', '17.3', '67.4', '49.1', '1840', '6', '0.381', '79', '6.5'];
    const p = parseInbodyCsv(`${header.join(',')}\n${row.join(',')}`);
    expect(p.scans[0]).toMatchObject({
      weightKg: 81.5,
      skeletalMuscleKg: 36.4,
      bodyFatKg: 14.1,
      bodyFatPct: 17.3,
      leanMassKg: 67.4,
      totalBodyWaterL: 49.1,
      bmrKcal: 1840,
      visceralFatLevel: 6,
      ecwRatio: 0.381,
      inbodyScore: 79,
      phaseAngle: 6.5,
    });
  });

  it('matches camelCase and snake_case', () => {
    const p = parseInbodyCsv('testDate,bodyWeight,skeletalMuscleMass,percentBodyFat,fat_free_mass\n2026-08-04,81.5,36.4,17.3,67.4');
    expect(p.scans[0]).toMatchObject({ weightKg: 81.5, skeletalMuscleKg: 36.4, bodyFatPct: 17.3, leanMassKg: 67.4 });
  });

  it('prefers the full name when two columns claim one measure', () => {
    const p = parseInbodyCsv('Date,Muscle Mass,Skeletal Muscle Mass\n2026-08-04,40,36.4');
    expect(p.scans[0].skeletalMuscleKg).toBe(36.4);
  });

  it('reads segmental columns in their several spellings', () => {
    const header = ['Date', 'Segmental Lean Right Arm(kg)', 'LA Lean Mass(kg)', 'Lean Mass - Trunk', 'Right Leg Lean(kg)', 'Left Leg Lean Mass', 'Trunk Fat Mass(kg)', 'R Arm Fat(kg)', 'Segmental Fat Left Leg'];
    const row = ['2026-08-04', '3.6', '3.5', '29.6', '10.5', '10.4', '6.2', '0.6', '2.1'];
    const p = parseInbodyCsv(`${header.join(',')}\n${row.join(',')}`);
    expect(p.scans[0].segmentalLeanKg).toEqual({ rightArm: 3.6, leftArm: 3.5, trunk: 29.6, rightLeg: 10.5, leftLeg: 10.4 });
    expect(p.scans[0].segmentalFatKg).toEqual({ trunk: 6.2, rightArm: 0.6, leftLeg: 2.1 });
  });

  it('does not take a segmental percentage or an ECW analysis for a mass', () => {
    const p = parseInbodyCsv('Date,Right Arm Lean Mass Percent(%),Right Arm ECW/TBW,Right Arm Lean Mass(kg)\n2026-08-04,105,0.38,3.6');
    expect(p.scans[0].segmentalLeanKg).toEqual({ rightArm: 3.6 });
  });
});

describe('bytes', () => {
  it('decodes UTF-8, UTF-16 with a mark, and Windows-1252', () => {
    expect(decodeInbodyBytes(new TextEncoder().encode('Date,Weight(kg)'))).toBe('Date,Weight(kg)');
    const utf16 = new Uint8Array([0xff, 0xfe, ...[...'Date'].flatMap((c) => [c.charCodeAt(0), 0])]);
    expect(decodeInbodyBytes(utf16)).toBe('Date');
    expect(decodeInbodyBytes(new Uint8Array([0x44, 0xe9, 0x74, 0x65]))).toBe('Déte');
  });

  it('parses the same file whichever way it was encoded', () => {
    const text = 'Date,Weight(kg)\n2026-08-04,81.5';
    const utf16 = new Uint8Array([0xff, 0xfe, ...[...text].flatMap((c) => [c.charCodeAt(0), 0])]);
    expect(parseInbodyCsv(decodeInbodyBytes(utf16)).scans[0].weightKg).toBe(81.5);
  });
});

describe('scanDeltas', () => {
  const scan = (date: string, o: Partial<ParsedScan> = {}) => ({ date, weightKg: 80, skeletalMuscleKg: 35, bodyFatKg: 14, bodyFatPct: 17, ...o });

  it('has nothing for no scans, and no comparison for one', () => {
    expect(scanDeltas([])).toEqual({ latest: null, vsPrevious: null, vsEightWeeks: null });
    const one = scanDeltas([scan('2026-08-04')]);
    expect(one.latest?.date).toBe('2026-08-04');
    expect(one.vsPrevious).toBeNull();
    expect(one.vsEightWeeks).toBeNull();
  });

  it('compares the latest with the previous scan whatever order they come in', () => {
    const d = scanDeltas([scan('2026-08-04', { weightKg: 81.5, skeletalMuscleKg: 36.4, bodyFatKg: 14.1, bodyFatPct: 17.3 }), scan('2026-07-07', { weightKg: 81.1, skeletalMuscleKg: 36, bodyFatKg: 14.4, bodyFatPct: 17.8 }), scan('2026-05-05')]);
    expect(d.latest?.date).toBe('2026-08-04');
    expect(d.vsPrevious?.scan.date).toBe('2026-07-07');
    expect(d.vsPrevious?.days).toBe(28);
    expect(d.vsPrevious?.change).toEqual({ weightKg: 0.4, skeletalMuscleKg: 0.4, bodyFatKg: -0.3, bodyFatPct: -0.5 });
  });

  it('picks the scan nearest eight weeks back, between six and ten weeks', () => {
    const d = scanDeltas([scan('2026-08-04'), scan('2026-07-07'), scan('2026-06-09'), scan('2026-06-02'), scan('2026-05-05')]);
    expect(d.vsEightWeeks?.scan.date).toBe('2026-06-09');
    expect(d.vsEightWeeks?.days).toBe(56);
    // 63 days is inside the window; 91 is not.
    expect(scanDeltas([scan('2026-08-04'), scan('2026-06-02'), scan('2026-05-05')]).vsEightWeeks?.scan.date).toBe('2026-06-02');
    expect(scanDeltas([scan('2026-08-04'), scan('2026-05-05')]).vsEightWeeks).toBeNull();
    expect(scanDeltas([scan('2026-08-04'), scan('2026-07-21')]).vsEightWeeks).toBeNull();
  });

  it('leaves a change null when either scan lacks the measure, rather than calling it zero', () => {
    const d = scanDeltas([scan('2026-08-04', { bodyFatKg: undefined }), scan('2026-07-07')]);
    expect(d.vsPrevious?.change.bodyFatKg).toBeNull();
    expect(d.vsPrevious?.change.weightKg).toBe(0);
  });
});
