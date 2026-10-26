# `disable-model-invocation` across harnesses

Decision record for the frontmatter field this repo uses to keep rare or destructive
skills out of automatic model routing (bead `agnt-ctx-yf24`).

**Verdict:** rely on it for pi and Claude Code. Do not rely on it in Copilot CLI as
"invoke-only" — there it means "unreachable through the model-facing skill tool".

## What the field does

`disable-model-invocation: true` removes a skill from the list the model is offered.
The user can still invoke it explicitly. It does not summarise, rewrite, or
otherwise change how the body loads, which is what `docs/skills/skill-anatomy.md`
previously implied.

## Preservation and honouring

| Harness | Field survives materialisation | Loader honours it | Evidence |
| --- | --- | --- | --- |
| pi 1.4.0 | Yes — byte-identical copy | Yes — hidden from the prompt, `/skill:name` still works | `bin/installers/pi.mjs:182-204`, `scripts/lib/compose-agent.mjs:69-95`; `dist/core/skills.js:262` (parse) and `:279` (filter); `docs/skills.md:53` |
| Claude Code 2.1.294 | Yes — byte-identical copy | Yes — Claude cannot invoke it, `/skill-name` still works | `bin/installers/claude.mjs:160-201`, same token helper; [Claude Code skills docs](https://code.claude.com/docs/en/skills) ("Control who invokes a skill") |
| Copilot CLI (1.0.55 locally, 1.0.80/1.0.83 upstream) | N/A — no copy; `plugin.json` `"skills": "skills/"` serves the repo tree in place | Auto-invocation suppressed, but explicit model invocation fails; `/skill-name` works | `plugin.json:12`; [github/copilot-cli#4438](https://github.com/github/copilot-cli/issues/4438) (open, retested 1.0.83) |

Both materialisers copy `SKILL.md` as text and rewrite only `{{TOOL:...}}` /
`{{PATH:...}}` tokens, so frontmatter keys they do not know pass through untouched —
nothing re-serialises YAML. Verified by installing all three harnesses into
`/var/tmp/dmi-check` and diffing `skills/productivity/teach/SKILL.md` (the repo's
only current user of the field): both copies are byte-identical to the source.
`claude plugin validate /var/tmp/dmi-check/claude/skills` passes, i.e. Claude Code's
own validator accepts the field rather than warning about it.

pi was probed against the materialised tree with its own loader: 32 skills loaded,
31 advertised, `teach` parsed with `disableModelInvocation: true` and absent from
`formatSkillsForPrompt` output.

## Per-harness detail

**pi.** Documented and implemented. `docs/skills.md:53`: "Set
`disable-model-invocation: true` in frontmatter when a skill should be available only
through its explicit command", with the frontmatter table listing it as "Hide the
skill from automatic model selection".

**Claude Code.** Documented, and the docs are explicit about the enforcement: "Claude
can't invoke the skill on its own … If Claude tries anyway, Claude Code blocks the
call and instructs it not to reproduce the deploy steps another way", and it "removes
the skill from Claude's context entirely".

Two Claude-specific caveats:

- The field is a Claude Code extension, not part of the
  [Agent Skills spec](https://agentskills.io/specification), whose six fields
  (`name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`)
  are otherwise exhaustive. Claude Code ignores unknown fields, but packing or
  uploading a skill to claude.ai (or through the Skills API) "fails with a hard error
  instead of ignoring the field". Our plugin path is unaffected; a skill we ever
  publish to claude.ai must drop the field.
- `skillOverrides` does not apply to plugin skills, and our install is a plugin. The
  frontmatter field itself still applies there — only that settings-based alternative
  is unavailable.

**Copilot CLI.** The field is not in GitHub's skill documentation, which lists only
`name`, `description`, `license`, and `allowed-tools`. In practice the CLI filters
flagged skills out of the `skill()` tool's resolution list, so the model cannot call
them even when the user names one: `Skill not found`. Only the interactive
`/skill-name` slash command reaches a flagged skill, and `-p` mode has no slash path.
Upstream issue #4438 is open.

Local probing was not possible: the installed CLI is 1.0.55 (no `copilot skill`
subcommand), and prompt runs are refused by this machine's org policy. The upstream
report is the evidence for Copilot, tested on 1.0.80 and 1.0.83 — newer than 1.0.55,
so this may differ locally, in either direction.

## Options for "explicit invocation only", evaluated

| Option | Portable? | Enforced? | Verdict |
| --- | --- | --- | --- |
| `disable-model-invocation: true` | pi + Claude Code yes; Copilot suppresses but breaks tool-based invocation | Yes on pi/Claude | **Recommended** where suppressing auto-routing is the point and the explicit path is a human typing `/name` |
| Naming convention (e.g. `manual-*`) | Yes | No — no harness reads names | Rejected: a human signal we already get from the body |
| `metadata:` block | Yes (spec-legal) | No — pi and Claude read top-level keys only, Copilot undefined | Rejected: documentation that looks like enforcement |
| Keep such skills out of `skills/` | Yes | Yes, by not shipping the skill | Rejected: gives up the per-harness install entirely |

## Recommendation

Use the field when the danger is fuzzy automatic matching and the intended explicit
path is a human typing `/skill-name`: that is the case for a migration skill whose
`--apply` renames labels workspace-wide. Accept, and document, that on Copilot CLI it
also blocks model-mediated invocation, including `-p` runs — if a workflow needs
non-interactive access to such a skill, do not set the field and instead disable the
skill in that user's Copilot config (`copilot skill disable <name>`, or the `/skills`
toggle), which is harness-native and per-user.

## Reproducing

```sh
node bin/agent-cortex.mjs install claude  --output /var/tmp/dmi-check/claude
node bin/agent-cortex.mjs install pi      --output /var/tmp/dmi-check/pi
node bin/agent-cortex.mjs install copilot --output /var/tmp/dmi-check/copilot
diff skills/productivity/teach/SKILL.md /var/tmp/dmi-check/claude/skills/teach/SKILL.md
diff skills/productivity/teach/SKILL.md /var/tmp/dmi-check/pi/skills/productivity/teach/SKILL.md
claude plugin validate /var/tmp/dmi-check/claude/skills
```

The Copilot run writes only composed agent files — there is no skill copy to inspect.
