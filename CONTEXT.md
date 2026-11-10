# Iron

One person's lifting and food log with a personal trainer built in. Tracking works offline; the
coach is Claude and needs the internet.

## Training

**Routine**:
A saved plan of exercises, each with a set count, a rep range and a working weight.
_Avoid_: Programme, workout template

**Session**:
One visit to the gym, started from a routine (or a short session) and finished or discarded.
_Avoid_: Workout (as a noun for the record)

**Short session**:
A one-off session, suggested on request (a few exercises, a time, an effort) or made of the
exercises the owner picks (My own), kept out of the routines list.
_Avoid_: Quick workout, random workout

**Plan override**:
A change to one exercise for today's session only (sets, rep range or weight), which can be kept
in the routine or undone.
_Avoid_: Temporary edit, session edit

**Effort**:
How a finished exercise felt, one of Easy, Good or Hard, which decides next session's weight
when every set reached the top of the range.
_Avoid_: RPE, RIR (the stored form), feel score

**Level**:
How far the owner's best set on an exercise is over where they started on it (the best set of
their first three sessions), 5% a level; theirs alone, never a comparison with other people.
_Avoid_: Rank (the squat, bench and deadlift standing against other lifters), XP, score

**Total level**:
Every Level above 1, added across all the owner's exercises; a new exercise adds nothing to it.
_Avoid_: Player level, score, level-ups earned (it is read off the data and can fall with an edit)

**Badge**:
A mark passed on one of the ladders (sessions finished, tonnes lifted, total level, a barbell
lift's heaviest set), read off what was trained and never stored.
_Avoid_: Achievement, trophy, medal (the record icon), milestone

**Region**:
A coarse muscle grouping used for rest and reminders: legs, back, chest, shoulders, arms, core.
_Avoid_: Body part, muscle group (a finer grouping)

## Food

**Meal**:
A group of food items logged under one slot (breakfast, lunch, dinner, snack) on one day.

**Usual meal**:
A meal the owner eats as it is and saved to log again in one tap; Food offers the ones for the
time of day.
_Avoid_: Favourite, template, preset, Recipe

**Recipe**:
A batch the owner cooks from ingredients and splits into portions; a portion is logged as one
food item, and can sit inside a Usual meal.
_Avoid_: Usual meal, dish

**Logged day**:
A day with any food logged. Averages count logged days only, and so do the food badges.
_Avoid_: Tracked day, complete day

**Natural unit**:
The way a food is counted in life (a pack, a serving, a slice, an egg), carrying its weight in
grams.
_Avoid_: Portion size, measure

**Estimate**:
A figure Claude produced rather than one read from a label, the UK table or the owner; shown
with ≈ and trusted least.
_Avoid_: Guess, AI value

## Body

**Weigh-in**:
One bodyweight reading on a date, expected weekly on Monday.

**Body scan**:
One body-composition result from the gym's InBody machine (muscle, fat, water and more) on a
date.
_Avoid_: InBody (the brand), measurement

## Coach

**Coach**:
Claude acting as the owner's personal trainer inside the app.
_Avoid_: Assistant, AI, bot

**Moment**:
A point at which the coach may speak first: opening the app, after a set, after an exercise,
after a session, after a meal, at the end of the day, and the weekly review.

**Coach line**:
The one or two sentences the coach says at a moment; absent when it has nothing worth saying.
_Avoid_: Tip, nudge, message

**Coach note**:
Something the coach keeps in mind about the owner (a niggle, a preference), visible and
deletable in Settings.
_Avoid_: Memory, fact

**Spend cap**:
The monthly limit on what the coach may cost; at the cap the coach pauses until the 1st and
tracking carries on.
_Avoid_: Budget, quota
