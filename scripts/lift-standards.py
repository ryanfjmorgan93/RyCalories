#!/usr/bin/env python3
"""
Builds src/data/liftStandards.json from the OpenPowerlifting CSV: for each sex, age group and
weight class, how much raw (unequipped) lifters have squatted, benched and deadlifted at meets,
as percentiles of each lifter's best.

Run by hand, not in CI; the JSON it writes is committed like any other source file.

Usage:
    python3 -I scripts/lift-standards.py path/to/openpowerlifting-YYYY-MM-DD-*.csv

The CSV is the "openpowerlifting-latest.zip" download from https://openpowerlifting.gitlab.io/opl-csv/
OpenPowerlifting data is contributed to the public domain (its LICENSE.txt); attribution is given
in the app anyway.

What counts:
  - Equipment "Raw" only (no knee wraps, no supportive suits), sex M or F.
  - Successful lifts only (a positive Best3 figure), and no disqualified, doping-disqualified or
    no-show entries.
  - The age group is OpenPowerlifting's own AgeClass (entries with no known age are left out).
  - The weight class is worked out from the lifter's bodyweight on the day, into the IPF classes,
    whatever class the federation used.
  - Each lifter counts once per group and class: their best. Groups with fewer than 20 lifters
    are left out, so the app never compares against a handful of people.
"""
import csv
import json
import os
import sys
from collections import defaultdict

CLASSES = {'M': [59, 66, 74, 83, 93, 105, 120], 'F': [47, 52, 57, 63, 69, 76, 84]}
BANDS = ['13-15', '16-17', '18-19', '20-23', '24-34', '35-39', '40-44', '45-49', '50-54', '55-59', '60-64', '65-69', '70-74', '75-79', '80-999']
PCTS = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 99]
LIFTS = {'squat': 'Best3SquatKg', 'bench': 'Best3BenchKg', 'deadlift': 'Best3DeadliftKg'}
EXCLUDED_PLACES = {'DQ', 'DD', 'NS'}
MIN_LIFTERS = 20


def weight_class(sex, kg):
    for limit in CLASSES[sex]:
        if kg <= limit:
            return str(limit)
    return f'{CLASSES[sex][-1]}+'


def percentile(sorted_values, p):
    """Linear interpolation between closest ranks."""
    i = (p / 100) * (len(sorted_values) - 1)
    lo = int(i)
    hi = min(lo + 1, len(sorted_values) - 1)
    return sorted_values[lo] + (sorted_values[hi] - sorted_values[lo]) * (i - lo)


def number(text):
    try:
        return float(text)
    except ValueError:
        return None


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    path = sys.argv[1]
    best = defaultdict(dict)  # "M|24-34|83|squat" -> {name: best kg}
    with open(path, newline='', encoding='utf-8') as f:
        for row in csv.DictReader(f):
            sex = row['Sex']
            if sex not in CLASSES or row['Equipment'] != 'Raw' or row['Place'] in EXCLUDED_PLACES:
                continue
            band = row['AgeClass']
            bodyweight = number(row['BodyweightKg'])
            if band not in BANDS or not bodyweight or bodyweight <= 0:
                continue
            cls = weight_class(sex, bodyweight)
            for lift, column in LIFTS.items():
                kg = number(row[column])
                if kg is None or kg <= 0:
                    continue
                cell = best[f'{sex}|{band}|{cls}|{lift}']
                if kg > cell.get(row['Name'], 0):
                    cell[row['Name']] = kg

    cells = {}
    for key in sorted(best):
        values = sorted(best[key].values())
        if len(values) < MIN_LIFTERS:
            continue
        cells[key] = {'n': len(values), 'kg': [round(percentile(values, p) * 2) / 2 for p in PCTS]}

    stamp = os.path.basename(path).split('-')[1:4]  # openpowerlifting-YYYY-MM-DD-hash.csv
    out = {
        'source': 'OpenPowerlifting (public domain)',
        'date': '-'.join(stamp),
        'pcts': PCTS,
        'classes': {sex: [str(c) for c in limits] + [f'{limits[-1]}+'] for sex, limits in CLASSES.items()},
        'bands': BANDS,
        'cells': cells,
    }
    target = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'data', 'liftStandards.json')
    with open(target, 'w', encoding='utf-8') as f:
        json.dump(out, f, separators=(',', ':'))
        f.write('\n')
    print(f'{len(cells)} groups written to {os.path.normpath(target)}')


if __name__ == '__main__':
    main()
