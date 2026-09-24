#!/usr/bin/env python3
"""
Builds the two committed UK food data files from the CoFID 2021 spreadsheet:

  - src/data/ukFoodTable.json   — every CoFID food with a known energy value, mechanically
                                   extracted from the "1.3 Proximates" sheet.
  - src/data/ukFoodAliases.json — a curated layer of ~100 everyday home-cooking ingredient names,
                                   each hand-mapped to one CoFID code (chosen by reading the sheet,
                                   not guessed), plus an app-estimated per-item weight where the
                                   ingredient is normally counted rather than weighed.

Run by hand, not in CI — the JSON files it writes are committed like any other source file, and
nothing in the build re-runs this script. Re-running it against the same source spreadsheet
reproduces the same committed bytes: the sheet is a fixed, versioned publication, and this script
does no networking, randomness or wall-clock reads beyond fetching that one file.

Usage:
    python3 scripts/uk-food-table.py [path/to/cofid.xlsx]

With no argument, downloads the xlsx from gov.uk to a temporary file first.

Source: McCance and Widdowson's Composition of Foods Integrated Dataset (CoFID), 2021 edition.
Crown copyright, Open Government Licence v3.0 — Contains public sector information licensed under
the Open Government Licence v3.0 (https://www.nationalarchives.gov.uk/doc/open-government-licence/).
Publication page:
    https://www.gov.uk/government/publications/composition-of-foods-integrated-dataset-cofid
Spreadsheet:
    https://assets.publishing.service.gov.uk/media/60538b91e90e07527df82ae4/McCance_Widdowsons_Composition_of_Foods_Integrated_Dataset_2021..xlsx

Only the Python standard library is used — zipfile + xml.etree.ElementTree, no openpyxl — because
this script has to run on a machine with nothing installed beyond Python itself. An xlsx file is a
zip of XML parts; the sheet data and the shared-string table are read directly from those parts.

Alias unit-weight rule: no openly licensed UK per-item food weight table exists (the MAFF/FSA
"Food Portion Sizes" handbook is a commercial book and is not used here), so every alias `unit.grams`
below is this app's own estimate, marked `unitSource: "estimate"` in the written JSON. The one
figure anchored to something external is the egg: a medium egg is legally 53-63 g in the shell
under EU Regulation 589/2008 Article 4 (retained/OGL, see legislation.gov.uk), so 50 g edible
(shell-free) is used as a round, conservative estimate within that band — not a further citation.

Alias ingredient-form rule: every alias points at the raw / dried / as-bought CoFID row for that
ingredient — the form a UK home cook weighs *before* cooking it into a dish — because a recipe
ingredient's `grams` is the amount that went into the dish, not the amount that came out of it.
The one deliberate exception is a food that is normally bought and used already cooked or packed
that way (a canned pulse or vegetable, sliced ready-to-eat ham, canned tuna): there the "as bought"
state already *is* the cooked/packed one, so that is the row used, and each such choice is called
out in the comment beside it below.
"""

from __future__ import annotations

import json
import os
import re
import sys
import tempfile
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from typing import Optional

SOURCE_URL = (
    "https://assets.publishing.service.gov.uk/media/60538b91e90e07527df82ae4/"
    "McCance_Widdowsons_Composition_of_Foods_Integrated_Dataset_2021..xlsx"
)
PUBLICATION_URL = (
    "https://www.gov.uk/government/publications/composition-of-foods-integrated-dataset-cofid"
)
LICENCE = (
    "Open Government Licence v3.0 — Contains public sector information licensed under the "
    "Open Government Licence v3.0."
)
SHEET_NAME = "1.3 Proximates"
NS = {"a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL_NS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FOOD_TABLE_PATH = os.path.join(REPO_ROOT, "src", "data", "ukFoodTable.json")
ALIASES_PATH = os.path.join(REPO_ROOT, "src", "data", "ukFoodAliases.json")

# Column headers, exactly as they appear on row 1 of "1.3 Proximates". Located by header text
# rather than by a hardcoded column letter, so a reordered column in a future edition fails loudly
# instead of silently reading the wrong figures.
WANTED_COLUMNS = {
    "code": "Food Code",
    "name": "Food Name",
    "protein": "Protein (g)",
    "fat": "Fat (g)",
    "carbs": "Carbohydrate (g)",
    "kcal": "Energy (kcal) (kcal)",
}

# ---------------------------------------------------------------------------
# The curated alias layer.
#
# ~100 everyday home-cooking ingredients a UK home cook would photograph or type while building a
# recipe, each mapped to exactly one CoFID code chosen by reading the actual food names in the
# sheet (see uk-food-table.py's module docstring for the raw/as-bought rule and the egg citation).
# `unit` is present only for foods normally counted rather than weighed; its `grams` is always an
# app estimate (`unitSource: "estimate"`), never a copied figure.
#
# Keep every `words` entry lower-case and unique across the whole list — the loader's test enforces
# both, and a duplicate would make matching one of the two foods it maps to arbitrary.
ALIASES: list[dict] = [
    {"words": ["egg", "eggs"], "code": "12-937",
     "unit": {"label": "egg", "plural": "eggs", "grams": 50, "unitSource": "estimate"}},
    {"words": ["bacon", "bacon rasher", "bacon rashers"], "code": "19-497",
     "unit": {"label": "rasher", "plural": "rashers", "grams": 25, "unitSource": "estimate"}},
    {"words": ["streaky bacon"], "code": "19-016",
     "unit": {"label": "rasher", "plural": "rashers", "grams": 20, "unitSource": "estimate"}},
    {"words": ["sausage", "sausages", "pork sausage", "pork sausages"], "code": "19-510",
     "unit": {"label": "sausage", "plural": "sausages", "grams": 50, "unitSource": "estimate"}},
    {"words": ["cheddar", "cheddar cheese"], "code": "12-346"},
    {"words": ["mozzarella"], "code": "12-360"},
    {"words": ["parmesan", "parmesan cheese"], "code": "12-526"},
    {"words": ["feta", "feta cheese"], "code": "12-525"},
    {"words": ["cottage cheese"], "code": "12-539"},
    {"words": ["butter"], "code": "17-685"},
    {"words": ["olive oil"], "code": "17-038",
     "unit": {"label": "tbsp", "plural": "tbsp", "grams": 14, "unitSource": "estimate"}},
    {"words": ["milk", "whole milk"], "code": "12-596"},
    {"words": ["semi-skimmed milk", "semi skimmed milk"], "code": "12-313"},
    {"words": ["skimmed milk"], "code": "12-307"},
    {"words": ["onion", "onions"], "code": "13-499",
     "unit": {"label": "onion", "plural": "onions", "grams": 150, "unitSource": "estimate"}},
    {"words": ["spring onion", "spring onions"], "code": "13-352",
     "unit": {"label": "spring onion", "plural": "spring onions", "grams": 15, "unitSource": "estimate"}},
    {"words": ["garlic", "garlic clove", "garlic cloves"], "code": "13-244",
     "unit": {"label": "clove", "plural": "cloves", "grams": 3, "unitSource": "estimate"}},
    {"words": ["tomato", "tomatoes"], "code": "13-517",
     "unit": {"label": "tomato", "plural": "tomatoes", "grams": 100, "unitSource": "estimate"}},
    {"words": ["cherry tomato", "cherry tomatoes"], "code": "13-519",
     "unit": {"label": "cherry tomato", "plural": "cherry tomatoes", "grams": 15, "unitSource": "estimate"}},
    # As-bought exception (see module docstring): a tin of tomatoes is already the purchased form.
    {"words": ["tinned tomatoes", "chopped tomatoes", "canned tomatoes"], "code": "13-530"},
    {"words": ["pepper", "peppers", "bell pepper", "bell peppers"], "code": "13-524",
     "unit": {"label": "pepper", "plural": "peppers", "grams": 120, "unitSource": "estimate"}},
    {"words": ["mushroom", "mushrooms"], "code": "13-505",
     "unit": {"label": "mushroom", "plural": "mushrooms", "grams": 15, "unitSource": "estimate"}},
    {"words": ["spinach"], "code": "13-521"},
    {"words": ["potato", "potatoes"], "code": "13-489",
     "unit": {"label": "potato", "plural": "potatoes", "grams": 180, "unitSource": "estimate"}},
    {"words": ["sweet potato", "sweet potatoes"], "code": "13-463",
     "unit": {"label": "sweet potato", "plural": "sweet potatoes", "grams": 130, "unitSource": "estimate"}},
    {"words": ["rice", "white rice"], "code": "11-861"},
    {"words": ["basmati rice", "basmati"], "code": "11-857"},
    {"words": ["brown rice"], "code": "11-868"},
    {"words": ["pasta"], "code": "11-716"},
    {"words": ["wholewheat pasta", "wholemeal pasta"], "code": "11-718"},
    {"words": ["bread", "white bread"], "code": "11-980",
     "unit": {"label": "slice", "plural": "slices", "grams": 36, "unitSource": "estimate"}},
    {"words": ["wholemeal bread"], "code": "11-981",
     "unit": {"label": "slice", "plural": "slices", "grams": 38, "unitSource": "estimate"}},
    # CoFID has no plain "chicken breast, raw" row; "light meat, raw" is the boneless skinless
    # breast meat figure and is the standard UK-database proxy for it.
    {"words": ["chicken breast", "chicken breasts", "chicken"], "code": "18-290"},
    {"words": ["chicken thigh", "chicken thighs"], "code": "18-289"},
    {"words": ["beef mince", "minced beef", "mince"], "code": "18-469"},
    {"words": ["lean beef mince", "extra lean beef mince"], "code": "18-508"},
    {"words": ["salmon", "salmon fillet"], "code": "16-356"},
    # As-bought exception: tinned tuna is bought and used in its canned, drained form.
    {"words": ["tuna", "tinned tuna", "tuna tin"], "code": "16-416"},
    {"words": ["cod", "cod fillet"], "code": "16-372"},
    {"words": ["prawn", "prawns"], "code": "16-387"},
    # As-bought exception: sliced ham is bought and eaten cooked/cured, never weighed raw.
    {"words": ["ham", "sliced ham"], "code": "19-496"},
    {"words": ["turkey", "turkey breast"], "code": "18-349"},
    # As-bought exception: baked beans, kidney beans, chickpeas and haricot beans below are the
    # tinned, ready-to-use forms a UK kitchen actually buys and weighs out of the can.
    {"words": ["baked beans"], "code": "13-532"},
    {"words": ["kidney bean", "kidney beans", "red kidney beans"], "code": "13-660"},
    {"words": ["chickpea", "chickpeas", "chick pea", "chick peas"], "code": "13-670"},
    {"words": ["haricot bean", "haricot beans"], "code": "13-665"},
    {"words": ["lentil", "lentils", "red lentils"], "code": "13-657"},
    {"words": ["flour", "plain flour"], "code": "11-886"},
    {"words": ["wholemeal flour"], "code": "11-889"},
    {"words": ["sugar", "white sugar"], "code": "17-063"},
    {"words": ["oats", "porridge oats", "rolled oats"], "code": "11-788"},
    {"words": ["natural yoghurt", "plain yoghurt", "yoghurt", "yogurt"], "code": "12-184"},
    {"words": ["low fat yoghurt", "low fat yogurt"], "code": "12-379"},
    {"words": ["greek yoghurt", "greek yogurt"], "code": "12-555"},
    {"words": ["avocado", "avocados"], "code": "14-386",
     "unit": {"label": "avocado", "plural": "avocados", "grams": 150, "unitSource": "estimate"}},
    {"words": ["banana", "bananas"], "code": "14-318",
     "unit": {"label": "banana", "plural": "bananas", "grams": 100, "unitSource": "estimate"}},
    {"words": ["apple", "apples"], "code": "14-319",
     "unit": {"label": "apple", "plural": "apples", "grams": 130, "unitSource": "estimate"}},
    {"words": ["carrot", "carrots"], "code": "13-496",
     "unit": {"label": "carrot", "plural": "carrots", "grams": 80, "unitSource": "estimate"}},
    {"words": ["broccoli"], "code": "13-502"},
    {"words": ["single cream", "cream"], "code": "12-332"},
    {"words": ["double cream"], "code": "12-334"},
    {"words": ["honey"], "code": "17-050"},
    {"words": ["peanut butter"], "code": "14-892"},
    {"words": ["almond", "almonds"], "code": "14-896"},
    {"words": ["cashew", "cashews", "cashew nuts"], "code": "14-811"},
    {"words": ["walnut", "walnuts"], "code": "14-879"},
    {"words": ["cucumber"], "code": "13-523"},
    {"words": ["lettuce"], "code": "13-520"},
    # As-bought exception: sweetcorn is most commonly bought tinned in a UK kitchen.
    {"words": ["sweetcorn", "tinned sweetcorn"], "code": "13-529"},
    {"words": ["courgette", "courgettes"], "code": "13-627"},
    {"words": ["aubergine", "aubergines"], "code": "13-161"},
    {"words": ["leek", "leeks"], "code": "13-624"},
    {"words": ["celery"], "code": "13-636"},
    {"words": ["ginger"], "code": "13-890"},
    {"words": ["chilli", "chillies", "chilli pepper"], "code": "13-317"},
    {"words": ["lemon", "lemons"], "code": "14-128",
     "unit": {"label": "lemon", "plural": "lemons", "grams": 60, "unitSource": "estimate"}},
    {"words": ["lime", "limes"], "code": "14-132",
     "unit": {"label": "lime", "plural": "limes", "grams": 70, "unitSource": "estimate"}},
    {"words": ["orange", "oranges"], "code": "14-327",
     "unit": {"label": "orange", "plural": "oranges", "grams": 130, "unitSource": "estimate"}},
    {"words": ["strawberry", "strawberries"], "code": "14-324"},
    {"words": ["blueberry", "blueberries"], "code": "14-325"},
    {"words": ["grape", "grapes"], "code": "14-350"},
    {"words": ["mayonnaise", "mayo"], "code": "17-654"},
    {"words": ["ketchup", "tomato ketchup"], "code": "17-709"},
    {"words": ["vinegar"], "code": "17-339"},
    {"words": ["soy sauce", "soya sauce"], "code": "17-721"},
    {"words": ["quinoa"], "code": "14-843"},
    {"words": ["couscous"], "code": "11-901"},
    {"words": ["tofu"], "code": "13-570"},
    {"words": ["basil"], "code": "13-804"},
    {"words": ["coriander"], "code": "13-888"},
    # As-bought exception: frozen peas are bought and used frozen, not shelled fresh.
    {"words": ["pea", "peas"], "code": "13-527"},
    {"words": ["green bean", "green beans"], "code": "13-514"},
    {"words": ["coconut milk"], "code": "14-889"},
    {"words": ["soya milk", "soy milk"], "code": "12-524"},
]


def download_xlsx() -> str:
    fd, path = tempfile.mkstemp(suffix=".xlsx")
    os.close(fd)
    request = urllib.request.Request(
        SOURCE_URL, headers={"User-Agent": "RyCalories-uk-food-table-script/1.0"}
    )
    with urllib.request.urlopen(request) as response, open(path, "wb") as out:
        out.write(response.read())
    return path


def load_shared_strings(zf: zipfile.ZipFile) -> list[str]:
    root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    strings = []
    for si in root.findall("a:si", NS):
        strings.append("".join(t.text or "" for t in si.findall(".//a:t", NS)))
    return strings


def find_sheet_path(zf: zipfile.ZipFile, sheet_name: str) -> str:
    """Resolve a worksheet's XML part from its visible tab name, via workbook.xml's sheet list and
    workbook.xml.rels' relationship ids — never a hardcoded "sheetN.xml", which shifts between
    xlsx exports whenever a sheet is added, removed or reordered upstream."""
    workbook = ET.fromstring(zf.read("xl/workbook.xml"))
    sheets = workbook.find("a:sheets", NS)
    rel_id = None
    for sheet in sheets.findall("a:sheet", NS):
        if sheet.get("name") == sheet_name:
            rel_id = sheet.get(f"{REL_NS}id")
            break
    if rel_id is None:
        names = [s.get("name") for s in sheets.findall("a:sheet", NS)]
        raise SystemExit(f"Sheet {sheet_name!r} not found in workbook.xml (have: {names})")
    rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    for rel in rels:
        if rel.get("Id") == rel_id:
            return "xl/" + rel.get("Target")
    raise SystemExit(f"Relationship {rel_id!r} not found in workbook.xml.rels")


def column_letters(cell_ref: str) -> str:
    return re.match(r"[A-Z]+", cell_ref).group(0)


def round1(value: float) -> float:
    return round(value, 1)


def parse_number(raw: Optional[str]) -> tuple[Optional[float], str]:
    """CoFID cells are one of: a number, 'Tr' (trace — treated as 0), 'N' (present but not
    quantified — unknown) or blank (not analysed — unknown). Returns (value, reason); value is
    None for an unknown figure."""
    if raw is None:
        return None, "blank"
    text = raw.strip()
    if text == "":
        return None, "blank"
    if text == "N":
        return None, "N"
    if text == "Tr":
        return 0.0, "Tr"
    return float(text), "numeric"


def parse_proximates(xlsx_path: str) -> list[dict]:
    with zipfile.ZipFile(xlsx_path) as zf:
        shared = load_shared_strings(zf)
        sheet_root = ET.fromstring(zf.read(find_sheet_path(zf, SHEET_NAME)))

        def cell_value(c: ET.Element) -> Optional[str]:
            v = c.find("a:v", NS)
            if v is None or v.text is None:
                return None
            return shared[int(v.text)] if c.get("t") == "s" else v.text

        rows = sheet_root.find("a:sheetData", NS).findall("a:row", NS)
        if len(rows) < 4:
            raise SystemExit(f"{SHEET_NAME!r} has only {len(rows)} rows — expected a header plus data")

        # Row 1 carries the real column headers; rows 2-3 are secondary code/description labels
        # under the frozen pane, and data starts at row 4 (verified against the source: dimension
        # A1:BD2890, pane frozen at ySplit=3).
        header = {column_letters(c.get("r")): cell_value(c) for c in rows[0].findall("a:c", NS)}
        col = {}
        for key, label in WANTED_COLUMNS.items():
            matches = [letter for letter, text in header.items() if text == label]
            if len(matches) != 1:
                raise SystemExit(
                    f"Expected exactly one column headed {label!r} in {SHEET_NAME!r}, "
                    f"found {matches} — the sheet layout may have changed"
                )
            col[key] = matches[0]

        foods = []
        skipped = 0
        skip_reasons: dict[str, int] = {}
        for row in rows[3:]:
            cells = {column_letters(c.get("r")): cell_value(c) for c in row.findall("a:c", NS)}
            name = cells.get(col["name"])
            if not name or not name.strip():
                continue
            code = cells.get(col["code"])
            if not code or not code.strip():
                raise SystemExit(f"Row for {name!r} has no Food Code")

            kcal, kcal_reason = parse_number(cells.get(col["kcal"]))
            if kcal is None:
                skipped += 1
                skip_reasons[kcal_reason] = skip_reasons.get(kcal_reason, 0) + 1
                continue

            # Protein/fat/carbohydrate being 'N' or blank on a row whose energy IS known is rare
            # (one row in the 2021 edition: "Cheese, Brie, rind only", missing carbohydrate) and is
            # treated as 0 rather than dropping a food whose kcal figure is otherwise usable.
            protein, _ = parse_number(cells.get(col["protein"]))
            fat, _ = parse_number(cells.get(col["fat"]))
            carbs, _ = parse_number(cells.get(col["carbs"]))

            foods.append({
                "code": code.strip(),
                "name": name.strip(),
                "per100": {
                    "kcal": round1(kcal),
                    "protein": round1(protein or 0.0),
                    "carbs": round1(carbs or 0.0),
                    "fat": round1(fat or 0.0),
                },
            })

        print(
            f"Parsed {len(foods)} foods from {SHEET_NAME!r}; skipped {skipped} rows with unknown "
            f"energy ({skip_reasons}).",
            file=sys.stderr,
        )
        return foods


def write_json(path: str, data) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


def main() -> None:
    xlsx_path = sys.argv[1] if len(sys.argv) > 1 else None
    downloaded = False
    if xlsx_path is None:
        print(f"No xlsx path given — downloading from {SOURCE_URL}", file=sys.stderr)
        xlsx_path = download_xlsx()
        downloaded = True

    try:
        foods = parse_proximates(xlsx_path)
    finally:
        if downloaded:
            os.remove(xlsx_path)

    # Sorted by the Food Code string itself (not parsed as a number): deterministic and diffable,
    # which is all "sorted by code" is for here. A handful of 2021-edition codes have a 4-digit
    # tail (e.g. "11-1029") that sorts lexicographically before "11-99" as those, too; that is an
    # accepted quirk of the source data, not a bug in this sort.
    foods.sort(key=lambda f: f["code"])

    foods_by_code: dict[str, list[dict]] = {}
    for food in foods:
        foods_by_code.setdefault(food["code"], []).append(food)
    duplicate_codes = {code: rows for code, rows in foods_by_code.items() if len(rows) > 1}
    if duplicate_codes:
        # A genuine data-quality issue in the 2021 CoFID edition, not a parsing bug: two distinct
        # foods share Food Code 13-669 ("Aubergine, flesh and skin, roasted in rapeseed oil" and
        # "Watercress, raw"). `code` is meant to identify exactly one food — every lookup in the
        # app (matchAlias, the review screen's source line) resolves a code back to a row with a
        # first-match `find`, so leaving two rows on the same code makes that lookup pick whichever
        # row happens to sort first, silently mislabelling the other. `foods.sort()` above is a
        # STABLE sort, so `rows` here is still in the source sheet's own original order — the first
        # row keeps its real CoFID code; every later row sharing it is suffixed ("13-669#2", …) so
        # each committed row is unique. No alias below points at a duplicated code (checked below),
        # so this can never change which food an alias resolves to.
        for code, rows in sorted(duplicate_codes.items()):
            for i, food in enumerate(rows[1:], start=2):
                new_code = f"{code}#{i}"
                print(f"NOTE: Food Code {code!r} is shared by {len(rows)} rows in the source "
                      f"sheet ({', '.join(r['name'] for r in rows)!r}); kept on {rows[0]['name']!r}, "
                      f"{food['name']!r} given the unique code {new_code!r}.", file=sys.stderr)
                food["code"] = new_code

    all_codes = [food["code"] for food in foods]
    if len(all_codes) != len(set(all_codes)):
        raise SystemExit("Food Codes are still not unique after de-duplication — a suffixed code "
                          "must have collided with a real one")

    for alias in ALIASES:
        rows = foods_by_code.get(alias["code"])
        if not rows:
            raise SystemExit(f"Alias {alias['words']!r} points at code {alias['code']!r}, which is "
                              f"not in the parsed food table (dropped, or never existed)")
        if len(rows) > 1:
            raise SystemExit(f"Alias {alias['words']!r} points at code {alias['code']!r}, which is "
                              f"ambiguous ({len(rows)} foods share it)")

    seen_words: dict[str, str] = {}
    for alias in ALIASES:
        for word in alias["words"]:
            if word != word.lower():
                raise SystemExit(f"Alias word {word!r} is not lower-case")
            if word in seen_words:
                raise SystemExit(f"Alias word {word!r} is used by both {seen_words[word]!r} and "
                                  f"{alias['code']!r}")
            seen_words[word] = alias["code"]

    write_json(FOOD_TABLE_PATH, {
        "source": {
            "name": "McCance and Widdowson's Composition of Foods Integrated Dataset (2021)",
            "version": "2021",
            "url": PUBLICATION_URL,
            "licence": LICENCE,
        },
        "foods": foods,
    })
    write_json(ALIASES_PATH, ALIASES)

    size_kb = os.path.getsize(FOOD_TABLE_PATH) / 1024
    print(f"Wrote {FOOD_TABLE_PATH} ({len(foods)} foods, {size_kb:.1f} KB) and {ALIASES_PATH} "
          f"({len(ALIASES)} aliases).", file=sys.stderr)


if __name__ == "__main__":
    main()
