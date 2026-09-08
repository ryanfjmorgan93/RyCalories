import uuid, json
NS = uuid.UUID('6f1c2b6e-7c1a-4d2e-9b3a-1e2f3a4b5c6d')
def uid(kind, key): return str(uuid.uuid5(NS, f'iron:{kind}:{key}'))

# name, kind, muscle, compound, lower, rest, inc, unilateral, aliases, notes
EX = [
 ("Romanian Deadlift (Barbell)", 'reps', 'hamstrings', True, True, 150, 5, False, [], None),
 ("Hip Thrust (Barbell)", 'reps', 'glutes', True, True, 150, 5, False, [], None),
 ("Lying Leg Curl (Machine)", 'reps', 'hamstrings', False, True, 75, 5, False, [], None),
 ("Back Extension", 'bodyweight_plus', 'lower back', False, True, 75, 5, False, ["Back Extension (Weighted Hyperextension)", "Back Extension (Hyperextension)", "Hyperextension"], "Base is bodyweight; the weight logged is the added plate."),
 ("Farmer's Carry", 'carry', 'full body', False, False, 90, 2, False, ["Farmers Walk", "Farmer's Walk", "Farmers Carry"], "One walk per set. Log weight and distance."),
 ("Seated Calf Raise", 'reps', 'calves', False, True, 75, 5, False, ["Seated Calf Raise (Machine)"], None),
 ("Bench Press (Barbell)", 'reps', 'chest', True, False, 150, 2.5, False, [], None),
 ("Incline DB Press", 'reps', 'chest', True, False, 150, 2, False, ["Incline Bench Press (Dumbbell)", "Incline Press (Dumbbell)"], "Weight is per hand."),
 ("DB Shoulder Press", 'reps', 'shoulders', True, False, 150, 2, False, ["Overhead Press (Dumbbell)", "Shoulder Press (Dumbbell)", "Seated Overhead Press (Dumbbell)"], "Weight is per hand."),
 ("Triceps Pushdown", 'reps', 'triceps', False, False, 75, 2.5, False, ["Triceps Pushdown (Cable)", "Tricep Pushdown"], None),
 ("Barbell Back Squat", 'reps', 'quads', True, True, 150, 5, False, ["Squat (Barbell)", "Back Squat (Barbell)"], None),
 ("Bulgarian Split Squat", 'reps', 'quads', False, True, 75, 2, True, ["Bulgarian Split Squat (Dumbbell)", "Bulgarian Split Squat (Bodyweight)"], "Log once per set; per leg is implied. Weight is per hand."),
 ("Leg Extension", 'reps', 'quads', False, True, 75, 5, False, ["Leg Extension (Machine)"], None),
 ("Hip Adductor (Machine)", 'reps', 'adductors', False, True, 75, 5, False, ["Hip Adduction (Machine)"], None),
 ("Standing Calf Raise", 'reps', 'calves', False, True, 75, 5, False, ["Standing Calf Raise (Machine)", "Standing Calf Raise (Smith Machine)"], None),
 ("Lat Pulldown (Machine)", 'reps', 'lats', True, False, 150, 5, False, ["Lat Pulldown (Cable)"], None),
 ("Iso-Lateral Row (Machine)", 'reps', 'upper back', True, False, 150, 5, False, ["Seated Row (Machine)"], None),
 ("Heavy DB Shrugs", 'reps', 'traps', True, False, 150, 2, False, ["Shrug (Dumbbell)"], "Weight is per hand."),
 ("DB Curl", 'reps', 'biceps', False, False, 75, 1, False, ["Bicep Curl (Dumbbell)", "Biceps Curl (Dumbbell)"], "Weight is per hand."),
 ("Incline DB Curl", 'reps', 'biceps', False, False, 75, 1, False, ["Incline Curl (Dumbbell)", "Incline Bicep Curl (Dumbbell)"], "Weight is per hand."),
 ("Hammer Curl", 'reps', 'biceps', False, False, 75, 1, False, ["Hammer Curl (Dumbbell)"], "Weight is per hand."),
 ("Overhead Triceps Extension", 'reps', 'triceps', False, False, 75, 2.5, False, ["Overhead Triceps Extension (Cable)", "Triceps Extension (Cable)", "Overhead Tricep Extension"], None),
 ("Lateral Raise", 'reps', 'shoulders', False, False, 75, 1, False, ["Lateral Raise (Dumbbell)"], "Weight is per hand."),
 ("Rear Delt Fly (Machine)", 'reps', 'rear delts', False, False, 75, 5, False, ["Rear Delt Reverse Fly (Machine)", "Reverse Fly (Machine)"], None),
 ("Face Pull", 'reps', 'rear delts', False, False, 75, 5, False, ["Face Pull (Cable)"], None),
 ("Cable Crunch", 'reps', 'abs', False, False, 75, 5, False, ["Cable Crunch (Kneeling)"], None),
 ("Neck", 'reps', 'neck', False, False, 75, 2.5, False, ["Lying Neck Curls (Weighted)", "Neck Curl", "Neck Extension", "Neck Curl (Weighted)", "Neck Extension (Weighted)"], "Plate on forehead lying back, or the neck machine."),
]
exid = {e[0]: uid('exercise', e[0]) for e in EX}

# routines: name, lower, target, exercises: (name, sets, setsMax, repMin, repMax, weight|None, inc, mode, cue, optional, extra)
R = [
 ("Lower (Hinge)", True, 50, [
   ("Romanian Deadlift (Barbell)", 4, None, 6, 8, 110, 5, 'normal', "Straps. 3-sec lower. Depth over load.", False, {}),
   ("Hip Thrust (Barbell)", 4, None, 6, 8, 95, 5, 'normal', "Squeeze hard at the top.", False, {}),
   ("Lying Leg Curl (Machine)", 4, None, 10, 12, 40, 5, 'normal', "Slow 3-sec lower.", False, {}),
   ("Back Extension", 3, None, 10, 15, 0, 5, 'normal', "Add a plate when 15 is easy.", False, {}),
   ("Farmer's Carry", 3, 4, 1, 1, None, 2, 'calibrating', "Heavy. Walk 30–40 m.", False, {"distanceMinM": 30, "distanceMaxM": 40}),
   ("Seated Calf Raise", 4, None, 12, 15, 40, 5, 'normal', "Heel all the way down. 2-sec pause at the bottom. Slow.", False, {}),
 ]),
 ("Upper (Push)", False, 45, [
   ("Bench Press (Barbell)", 4, None, 6, 8, 65, 2.5, 'normal', None, False, {}),
   ("Incline DB Press", 3, None, 6, 8, None, 2, 'calibrating', "Was ~22–26 kg per hand. Lock in on session one.", False, {}),
   ("DB Shoulder Press", 3, None, 6, 8, None, 2, 'calibrating', "DB or Smith. NOT the machine shoulder press. Was ~18–22 kg.", False, {}),
   ("Triceps Pushdown", 3, None, 12, 15, None, 2.5, 'calibrating', "Arm priority.", False, {}),
 ]),
 ("Lower (Squat)", True, 50, [
   ("Barbell Back Squat", 4, None, 6, 8, None, 5, 'calibrating', "Brace hard before every rep. Full depth. Leave 1–2 in the tank while the pattern beds in.", False, {}),
   ("Bulgarian Split Squat", 3, None, 6, 8, None, 2, 'calibrating', "Bodyweight to 10 kg DBs. Balance is the limiter early.", False, {}),
   ("Leg Extension", 3, None, 12, 15, None, 5, 'calibrating', "Full lockout + 1-sec squeeze at the top. That's the inner quad.", False, {}),
   ("Hip Adductor (Machine)", 3, None, 15, 15, None, 5, 'calibrating', "Inner thigh thickness.", False, {}),
   ("Standing Calf Raise", 4, None, 12, 15, None, 5, 'calibrating', "Heel all the way down. 2-sec pause at the bottom. Slow.", False, {}),
 ]),
 ("Upper (Pull)", False, 45, [
   ("Lat Pulldown (Machine)", 4, None, 6, 8, 90, 5, 'normal', None, False, {}),
   ("Iso-Lateral Row (Machine)", 4, None, 6, 8, 85, 5, 'normal', "Chest-supported. Keeps the lower back out of it.", False, {}),
   ("Heavy DB Shrugs", 3, 4, 10, 12, None, 2, 'calibrating', "Heaviest you can hold. Straps. Squeeze at the top.", False, {}),
   ("DB Curl", 3, None, 10, 12, 9, 1, 'normal', "Arm priority.", False, {}),
 ]),
 ("Arms (Day 5)", False, 60, [
   ("DB Curl", 4, None, 8, 12, 9, 1, 'normal', "Up when you hit 12 on every set.", False, {}),
   ("Incline DB Curl", 3, None, 10, 12, None, 1, 'calibrating', "Arms hang back. Big stretch at the bottom.", False, {}),
   ("Hammer Curl", 3, None, 10, 12, None, 1, 'calibrating', "Outer arm + forearm.", False, {}),
   ("Overhead Triceps Extension", 4, None, 10, 12, None, 2.5, 'calibrating', "Long head = the mass.", False, {}),
   ("Triceps Pushdown", 3, None, 12, 15, None, 2.5, 'calibrating', None, False, {}),
   ("Lateral Raise", 3, None, 12, 15, 8, 1, 'normal', "Strict. No swing.", False, {}),
   ("Rear Delt Fly (Machine)", 3, None, 15, 15, 35, 5, 'normal', "Or Face Pull at 50 kg.", False, {}),
   ("Cable Crunch", 3, None, 12, 15, None, 5, 'calibrating', None, True, {}),
   ("Neck", 2, 3, 15, 20, None, 2.5, 'calibrating', "Plate on forehead lying back, or the neck machine.", True, {}),
   ("Standing Calf Raise", 3, None, 12, 15, None, 5, 'calibrating', "2-sec pause at the bottom.", True, {}),
 ]),
]

def ts(v):
    return json.dumps(v, ensure_ascii=False)

out = []
out.append("/* AUTO-GENERATED by scratch/gen/seed.py — edit that script, not this file. */")
out.append("import type { Exercise, Routine, RoutineExercise } from '@/domain/types';")
out.append("")
out.append("/** Fixed UUIDs so 'reset to seed' and imports are stable across installs. */")
out.append("export const SEED_EXERCISE_IDS = {")
for e in EX:
    out.append(f"  {ts(e[0])}: {ts(exid[e[0]])},")
out.append("} as const;")
out.append("")
out.append("export const SEED_ROUTINE_IDS = {")
for r in R:
    out.append(f"  {ts(r[0])}: {ts(uid('routine', r[0]))},")
out.append("} as const;")
out.append("")
out.append("export const SEED_EXERCISES: Omit<Exercise, 'createdAt'>[] = [")
for name, kind, muscle, comp, lower, rest, inc, uni, aliases, notes in EX:
    fields = [f"id: {ts(exid[name])}", f"name: {ts(name)}", f"kind: {ts(kind)}", f"muscleGroup: {ts(muscle)}",
              f"isCompound: {ts(comp)}", f"isLowerBody: {ts(lower)}", f"defaultRestSec: {rest}", f"defaultIncrement: {inc}", f"unilateral: {ts(uni)}"]
    if aliases: fields.append(f"aliases: {ts(aliases)}")
    if notes: fields.append(f"notes: {ts(notes)}")
    out.append("  { " + ", ".join(fields) + " },")
out.append("];")
out.append("")
out.append("export const SEED_ROUTINES: Routine[] = [")
for i, (name, lower, target, _) in enumerate(R):
    out.append(f"  {{ id: {ts(uid('routine', name))}, name: {ts(name)}, order: {i}, isLowerBody: {ts(lower)}, targetMinutes: {target} }},")
out.append("];")
out.append("")
out.append("export const SEED_ROUTINE_EXERCISES: RoutineExercise[] = [")
for rname, lower, target, exs in R:
    rid = uid('routine', rname)
    for j, (ename, sets, setsMax, rmin, rmax, w, inc, mode, cue, opt, extra) in enumerate(exs):
        fields = [f"id: {ts(uid('rx', f'{rname}:{j}:{ename}'))}", f"routineId: {ts(rid)}", f"exerciseId: {ts(exid[ename])}", f"order: {j}",
                  f"targetSets: {sets}"]
        if setsMax: fields.append(f"targetSetsMax: {setsMax}")
        fields += [f"repMin: {rmin}", f"repMax: {rmax}", f"currentWeight: {w if w is not None else 0}", f"increment: {inc}", f"mode: {ts(mode)}"]
        if cue: fields.append(f"cue: {ts(cue)}")
        fields.append(f"optional: {ts(opt)}")
        for k, v in extra.items(): fields.append(f"{k}: {v}")
        out.append("  { " + ", ".join(fields) + " },")
out.append("];")
out.append("")
out.append("export const SEED_BODYWEIGHT_KG = 74;")
out.append("export const SEED_VERSION = 1;")
open('src/db/seed.ts', 'w').write("\n".join(out) + "\n")
print("wrote seed.ts", len(EX), "exercises,", sum(len(r[3]) for r in R), "routine-exercises")
