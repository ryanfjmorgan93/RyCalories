# Claude is the only AI

The on-device Gemini Nano assistant (AICore, a native plugin, a model download) could only answer short questions on a tap, so the owner asked for Claude through the Anthropic API instead, paid from their plan's API credit. Nano is removed entirely rather than kept as a fallback: two assistants with different abilities in one app was confusing, and the native plugin was the only native code. Tracking stays fully offline; only the coach, describing food and reading photos need the internet, and they say so plainly when it is missing.

## Consequences

- Claude calls are a third thing that leaves the device (with Open Food Facts and the Video link), listed in Settings → About.
- Sonnet does conversation, tool use and photo reading; Haiku does the short coach lines. Opus is not used (the owner's choice, on cost).
- Spending is capped in the app (default $15 a month), counted from each response's usage, because the same credit funds the owner's other projects. The owner is also told to set the same limit on the workspace in the Claude Console as a backstop.
