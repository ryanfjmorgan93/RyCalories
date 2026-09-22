# Installed Claude Code skills

Vendored third-party skills, committed so they persist for every session in
this repo (a cloud session's `~/.claude` is ephemeral; a project `.claude/`
is not). 69 skills, all MIT-licensed.

Each skill keeps its upstream directory name and its original `SKILL.md`
frontmatter, so upstream docs and cross-references still apply.

## Sources

| Source | Skills | Upstream commit | License |
|---|---|---|---|
| [googlarz/fashion-skill](https://github.com/googlarz/fashion-skill) | 1 | `da3224bb` | MIT |
| [JuliusBrussee/caveman](https://github.com/juliusbrussee/caveman) | 20 | `2fd153c6` | MIT (`skills/` only) |
| [affaan-m/ecc](https://github.com/affaan-m/ecc) | 47 | `bf70150e` | MIT |
| [latent-spaces/brag](https://github.com/latent-spaces/brag) | 1 | `57ce4c9b` | MIT |

`fashion` was found via [awesome-claude-code#1800](https://github.com/hesreallyhim/awesome-claude-code/issues/1800).

## What was installed, and what was left out

**fashion** — `SKILL.md` + `references/`, complete.

**caveman** — all 20 skills under upstream `skills/`. The compression *proxy*
and *middleware* were **not** installed: they are BSL-1.1 (not MIT), run a
local process between the agent and the provider, and need a separate runtime.
The `caveman` skill alone gives the terse-output behaviour; it needs no daemon.

**ecc** — ECC is not a single skill but a 292-skill / 68-agent harness
framework. Installed here is its own **`core` profile** scope for skills, i.e.
the 47 `workflow-quality` skills (TDD, code review, verification, planning,
repo onboarding). Deliberately excluded:

- `hooks-runtime` — executes code on tool events and needs `settings.json`
  wiring; not something to enable silently.
- `rules-core` — always-loaded rules that would change every session's
  behaviour in this repo.
- `platform-configs` — adapters for Cursor/Codex/Gemini/Zed and other harnesses.
- the remaining ~245 skills (ML, prediction markets, social distribution, etc.).

To widen later, use upstream's installer rather than hand-copying:
`npx ecc-universal@2.2.2 install --profile developer --target claude`.

**brag** — complete, including the 16MB of bundled `.ogg` music beds and SFX
under `brag/assets/`, which the skill needs to score a video. `/brag` also
needs Node 22+, FFmpeg and the Hyperframes CLI at run time.

## Updating

These are vendored copies, not submodules — re-copy from upstream to update.

## Slash commands

`.claude/commands/` holds one generated shim per skill, so each appears in the
`/` picker (including in the mobile and web apps, whose autocomplete lists
slash commands rather than skills). Each shim just invokes the matching skill
and forwards `$ARGUMENTS`. Regenerate them after adding or removing a skill.

## Which skills work standalone

All 69 are installed, mapped to a `/` command, and invocable. But ECC's
`hooks-runtime` is deliberately not installed (see above), and a few skills
*are* hooks rather than instructions. Verified by scanning every `SKILL.md`
for hook-delivered mechanisms:

**57 skills — fully standalone.** Nothing further needed.

**6 skills — degraded but usable.** They work when invoked; only their
automatic triggering is lost: `inherit-legacy-style` (its "soft hook" option
needs no wiring), `agent-self-evaluation` (hook is optional by design),
`verification-loop`, `growth-log`, `ecc-guide` (reports hooks as absent),
`configure-ecc` (its `CLAUDE_PLUGIN_ROOT` assumptions don't hold for a
vendored copy).

**6 skills — inert until hooks are wired.** The hook *is* the mechanism:

| Skill | Ships its script? | To enable |
|---|---|---|
| `ck` | yes (`hooks/session-start.mjs`) | register SessionStart in settings.json |
| `continuous-learning-v2` | yes (9 scripts) | register PreToolUse/PostToolUse |
| `delivery-gate` | yes | register Stop hook |
| `strategic-compact` | no | needs ECC `scripts/suggest-compact.js` |
| `caveman-stats` | no | needs caveman `src/hooks/*.js` |
| `plankton-code-quality` | no | needs the external Plankton tool |

Wiring these means executable code running on tool events, so it is left off
by default. `continuous-learning` is upstream-deprecated in favour of v2.

Note: scanning also flagged references to skills like `dead-skill`,
`skill-name` and `search-first`. Those are placeholder paths in documentation,
not missing dependencies.
