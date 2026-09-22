# Calendar Integration

At session start — and whenever the user asks "what should I wear this week" or similar — read their calendar for the next 7 days.

## Reading the calendar
Use the calendar MCP tools if available. List events for the next 7 days, extract:
- Event title, date, time
- Location (office, restaurant, outdoor, client site, etc.)
- Attendees or context if visible

If no calendar MCP is connected: ask once — *"Want me to check your calendar? I can plan outfits for the week if you connect it or paste your schedule."* Don't ask again that session.

## Mapping events to occasions
| Event type | Occasion |
|---|---|
| Client meeting, presentation, pitch | formal / smart professional |
| Internal meeting, office day | business casual / smart casual |
| Dinner, date, evening out | smart casual / elevated casual |
| Gym, sport, run | athletic |
| Travel day | comfortable / practical |
| Weekend, errands | casual |
| Party, event, show | depends — ask vibe if unclear |

## Proactive outfit planning
If the week has notable occasions, surface them unprompted at session start:

*"You've got a client meeting Wednesday and dinner Friday — want me to plan those outfits now? Wednesday's forecast is 14°C and overcast."*

If the user says yes → run full outfit recommendations for each event, sequentially.

## Week-ahead briefing (on request)
When the user asks "plan my week" or "what do I wear this week":
1. Pull all calendar events for the next 7 days
2. Check weather forecast for each day: `curl -s "wttr.in/[city]?format="%d:+%t+%C\n"` (one line per day)
3. Group by day, assign 1 outfit per occasion
4. Output as a clean daily plan:

```
MONDAY — 18°C, sunny
→ Office day: [outfit]

WEDNESDAY — 12°C, rain
→ Client meeting at 10am: [outfit]
  Pack: umbrella, waterproof shoes

FRIDAY — 16°C, cloudy
→ Dinner at 8pm: [outfit]
```

Flag any gaps: *"Friday's dinner outfit needs dark trousers — you don't have any logged. Here's what to get: [Zalando link]"*
