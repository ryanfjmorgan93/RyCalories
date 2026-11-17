# Diet check — design

Asked for by the owner in November 2026, in place of the weekly shop: "some sort of dietitian
analyzer … it analyses the food I've eaten throughout the weeks and days and it gives me healthier
or better eating options", for their standing aim: "build muscle, get a six pack, nine to ten
percent body fat". Then: "Doesn't necessarily need to be about calories, because I'm pretty good at
hitting my caloric target and my protein target. It's more like just the nutritional", with the
example of Fridge Raiders as a daily snack: "is that going to be affecting my body fat percentage or
the fat stored around my stomach". They approved a three-screen concept, asked for the one-food view
to stay and for an overview that recommends what would serve the goal better and what to cut.

## What it is

One tap on Food → Diet check. The coach (Claude, Sonnet, one request) reads the last 28 days of the
diary, food by food, and answers in a fixed shape:

- a **score out of 100 ≈**, the sum of four parts out of 25: whole foods, fruit and veg, fibre,
  processed and salt, each with one line saying why;
- a headline and a second, quieter sentence;
- **what is working**, **add** and **cut back**, up to three each;
- **your regulars**: the foods eaten most, each Keep, Fine, Swap or Cut back; a tap opens the food:
  what it does for their body fat, the catch, a better option, and Ask the coach about this (which
  puts the question in the coach's box).

## Decisions

- **Tap only** (the owner's choice over a Monday run). The answer is kept in the Settings row
  (`dietCheck`) until the next tap, so the screen and a food's sheet ask nothing.
- **Not about calories or protein.** The rules tell the coach they are already hit and not to score
  them.
- **Myths are answered straight.** No single food puts fat on the stomach; body fat follows total
  calories over weeks; salt holds water, not fat. Written into the coach's rules (`DIET_RULES`).
- **It is the coach speaking**, so advice is allowed (CLAUDE.md: the coach may speak; nothing else
  lectures). The screen says "The coach's reading of your diary" and the score carries ≈: the app
  stores calories, protein, carbs and fat only, so fibre, veg and salt are Claude's estimates.
- **The numbers that are the app's stay the app's.** The score is the four parts added up
  (`dietScore`), points are held to 0–25, a verdict is shown only for a food that is in the diary,
  and how often it was eaten comes from the diary, never from the answer (`cleanDietCheck`).
- **Fewer than 3 logged days** in the window: it says so and asks nobody. The days logged are always
  shown ("21 of 28 days logged").
- **Estimates are included** (a takeaway Claude read from a photo is part of the diet), marked ≈ in
  what the coach is sent.
- Nothing new leaves the device: it is a Claude call like the weekly review, inside the spend cap,
  covered by Settings → About ("a summary of your training, food …").

## Not built

A score per day, and a Monday run by itself. The owner asked for neither in the end.
