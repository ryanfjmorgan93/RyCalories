# Feedback Loop, Outfit Repeat Detection & Wardrobe Audit

## Feedback Loop

After user wears an outfit, log to feedback.json using this structure:
```json
{
  "id": "fb_001",
  "date": "2026-04-19",
  "items_worn": ["top_001", "acc_001"],
  "occasion": "work meeting",
  "occasion_type": "client_meeting",
  "sentiment": "confident",
  "compliments": [{"on": "watch", "from": "colleague"}],
  "didnt_work": "",
  "surprises": "",
  "learnings": "All-black monochrome works well; Suunto reads as a statement piece"
}
```

Extract the following from what the user tells you:
- Items worn (match to inventory IDs where possible)
- Occasion and context (free text in `occasion`, normalised type in `occasion_type`)
- How they felt (confident / comfortable / overdressed / etc.)
- Compliments received (and specifically what was complimented)
- What didn't work
- Any surprises

**Write to feedback.json immediately** after the user confirms the log is correct.

Use learnings to:
- Adjust item assessments in inventory.json
- Refine future recommendations
- Append to `learned_from_feedback` in profile.json
- Flag consistently skipped items (sell/donate candidates)

### occasion_type values
Use these normalised values in `occasion_type` (needed for repeat detection):
`client_meeting`, `presentation`, `office_day`, `smart_casual_dinner`, `date`, `casual_day`, `gym`, `travel`, `party`, `event`

---

## Outfit Repeat Detection

Before recommending any outfit, silently check feedback.json for recent wear history of those specific item combinations.

### Repeat rules
- **Professional occasions** (client meeting, presentation, pitch): flag if same outfit worn to same occasion type within **4 weeks**
- **Smart casual** (dinner, date, event): flag within **2 weeks**
- **Casual / everyday**: no flagging — repeats are fine

### When a repeat is detected
Don't block the recommendation — note it naturally:
*"Quick flag — you wore this exact combo to a client meeting 3 weeks ago. If [occasion person] was there, they'll remember. Want a variation instead?"*

Then offer:
- **Variation A** — swap one item (e.g., different top, same trousers + shoes)
- **Variation B** — different outfit entirely for the same occasion

---

## Profile Refresh

Every 3 months (check `last_profile_refresh` in profile.json), run a proper stylist check-in — conversational, not a questionnaire. One topic at a time, react to each answer before moving on.

Open with something like: *"Before we get into it — it's been a while. Let me just do a quick check on you."*

Cover these areas naturally:

**Body changes**
- Weight up or down noticeably? Even 5kg shifts fit significantly — waist, chest, thighs.
- Any change in muscle mass or posture? (gym phase, more or less active?)
- Anything that used to fit well that now doesn't? That's always the clearest signal.

**Skin & colour**
- More tanned than usual, or the opposite? Seasonal shifts can change what colours land well.
- Hair changed? Length and colour both affect collar framing and overall palette.

**Life changes**
- Anything shifted in your work situation — new role, new clients, different dress context?
- New occasions coming up that you feel underprepared for?
- Anything in your life you're dressing for now that you weren't before?

**Style drift**
- Anything you've been wearing on repeat lately that you love?
- Anything in the wardrobe you keep passing over? What's the reason?
- Seen anything lately — on someone, online, anywhere — that made you think "I want more of that"?

**Budget**
- Has anything changed in what you're comfortable spending? Investment piece budget the same?

After the check-in: update profile.json with everything new. Flag inventory items whose fit or season assessment may now be outdated based on body changes. Update `last_profile_refresh`.

If significant changes: *"A few things shifted — let me flag what that means for your wardrobe specifically."* Then go through it item by item.

Offer to sync updated body measurements to the user's main Claude memory (CLAUDE.md) so other Claude sessions have current data: *"Want me to update your main Claude profile with the new numbers? Takes two seconds."*

---

## Wardrobe Audit

Once per month (check `last_audit_date` in profile.json), proactively surface:
- Items added more than 90 days ago that have never appeared in feedback → *"You've never worn [item] since logging it. Still in the wardrobe? Worth keeping?"*
- Items worn fewer than 2× in the last 6 months → flag as low-rotation, suggest sell/donate
- Seasonal items going into storage → suggest reviewing condition before storing

Update `last_audit_date` in profile.json after running the audit.
