# Wardrobe Sprint & Weekly Reminder

## Wardrobe Sprint

When inventory is sparse (< 15 items), or the user wants to log everything quickly, switch to sprint mode — fast, low-friction, no perfectionism.

### Trigger phrases
"Log my wardrobe", "add everything I own", "wardrobe sprint", "let's build my inventory"

### Sprint mode
*"Let's go fast. You can send photos, describe items, or both — I'll identify, confirm, and log immediately. Don't overthink it. Go."*

Process each item:
1. Photo or description in → identify → one-line confirmation: *"Uniqlo white OCBD, size L — logging it?"*
2. User says yes / nods / sends next → log immediately, move on
3. No lengthy discussions during sprint — flag uncertain items for review after

Track sprint progress: *"8 logged, keep going —"*

End sprint with summary: *"Done — [N] items added. Here's what you now have: [category breakdown]. Biggest gaps: [top 3 missing items with Zalando links]."*

### Chrome import shortcut
Fastest way to fill inventory from past purchases:
*"I can import your full order history from Zalando and Amazon in one go — takes about 10 minutes. Want to do that now? You'll need to be logged in on both sites."*

See `references/import.md` for the full Purchase Import via Chrome flow.

---

## Weekly Reminder Setup

A scheduled remote agent that messages the user every Sunday evening: *"Time to plan your week — open /fashion and say 'plan my week'."*

> **Note:** The remote agent runs in Anthropic's cloud — it can't access your local files or calendar. It's a nudge only. The actual planning happens when you open the skill locally.

### What you need first
The remote agent needs a way to reach you. Best option: **iMessage MCP**.
Check if it's connected at [claude.ai/customize/connectors](https://claude.ai/customize/connectors). If not, connect it first — then come back.

If iMessage isn't available, alternatives: email (Proton MCP), Slack, or any other messaging connector you have set up.

### Setting it up

Tell the user:
*"To set this up I'll create a scheduled task that runs every Sunday at 6pm your time. It'll send you a short message reminding you to plan your week. You'll need the iMessage (or other messaging) connector active on claude.ai. Ready?"*

If yes — instruct them to run `/schedule` in a new Claude Code session, or guide them through this prompt to create the routine via `RemoteTrigger`:

**Routine config:**
- Name: `Fashion — Weekly Outfit Briefing`
- Schedule: `0 16 * * 0` (Sunday 4pm UTC = 6pm Europe/Berlin; adjust for your timezone)
- Prompt for the remote agent:
```
You are a fashion assistant reminder agent. Send a short, friendly iMessage to [USER_PHONE_OR_EMAIL] saying:

"Hey — it's Sunday. Take 2 minutes to plan your outfits for the week. Open Claude Code and say '/fashion plan my week' to get a full day-by-day plan with weather."

Keep it casual. One message, no follow-up.
```
- Replace `[USER_PHONE_OR_EMAIL]` with the user's actual contact before saving.

Store `weekly_reminder: true` and `weekly_reminder_day: "sunday"` in profile.json once set up.

### Disabling it
User says "stop the weekly reminder" or "turn off Sunday reminder" → set `weekly_reminder: false` in profile.json and tell them to disable or delete the routine at [claude.ai/code/routines](https://claude.ai/code/routines).
