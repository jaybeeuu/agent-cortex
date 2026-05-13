---
name: qa
description: Interactive QA session where user reports bugs or problems conversationally, and the agent files beads. Explores the codebase in the background for context and domain language. Use when user wants to report bugs, do QA, file beads conversationally, or mentions "QA session".
---

# QA Session

Run an interactive QA session. The user describes problems they're encountering. You clarify, explore the codebase for context, and file beads that are durable, user-focused, and use the project's domain language.

## For each bead the user raises

### 1. Listen and lightly clarify

Let the user describe the problem in their own words. Ask **at most 2-3 short clarifying questions** focused on:

- What they expected vs what actually happened
- Steps to reproduce (if not obvious)
- Whether it's consistent or intermittent

Do NOT over-interview. If the description is clear enough to file, move on.

### 2. Explore the codebase in the background

While talking to the user, spawn a `nexus` agent (`agent-cortex:nexus`) in the background with an explicit prompt to understand the relevant area. The goal is NOT to find a fix — it's to:

- Learn the domain language used in that area (check `.agent-cortex/ralph/ubiquitous-language.md`)
- Understand what the feature is supposed to do
- Identify the user-facing behavior boundary

This context helps you write a better bead — but the bead itself should NOT reference specific files, line numbers, or internal implementation details.

### 3. Assess scope: single bead or breakdown?

Before filing, decide whether this is a **single bead** or needs to be **broken down** into multiple beads.

Break down when:

- The fix spans multiple independent areas (e.g. "the form validation is wrong AND the success message is missing AND the redirect is broken")
- There are clearly separable concerns that different people could work on in parallel
- The user describes something that has multiple distinct failure modes or symptoms

Keep as a single bead when:

- It's one behavior that's wrong in one place
- The symptoms are all caused by the same root behavior

### 4. File the bead(s)

Invoke the `create-task` skill for each bead, passing the title, description (using the appropriate template below), and priority. Do NOT ask the user to review first — just file and share URLs.

Beads must be **durable** — they should still make sense after major refactors. Write from the user's perspective.

#### For a single bead

Use this template:

```
## What happened

[Describe the actual behavior the user experienced, in plain language]

## What I expected

[Describe the expected behavior]

## Steps to reproduce

1. [Concrete, numbered steps a developer can follow]
2. [Use domain terms from the codebase, not internal module names]
3. [Include relevant inputs, flags, or configuration]

## Additional context

[Any extra observations from the user or from codebase exploration that help frame the bead — e.g. "this only happens when using the Docker layer, not the filesystem layer" — use domain language but don't cite files]
```

#### For a breakdown (multiple beads)

Invoke `create-task` for each sub-bead in dependency order (blockers first) so you can reference real bead IDs. After each `create-task` invocation returns a bead ID, record any blocking relationships explicitly:

> **`bd dep add` arg order**: `bd dep add A B` means **"A depends on B"** (B blocks A).
> First arg waits, second arg is waited-for.

```bash
bd dep add <new-id> <blocker-id> --type blocks
```

Use this template for each sub-bead's description:

```
## Parent bead

#<parent-bead-number> (if you created a tracking bead) or "Reported during QA session"

## What's wrong

[Describe this specific behavior problem — just this slice, not the whole report]

## What I expected

[Expected behavior for this specific slice]

## Steps to reproduce

1. [Steps specific to THIS bead]

## Blocked by

- #<bead-number> (if this bead can't be fixed until another is resolved)

Or "None — can start immediately" if no blockers.

## Additional context

[Any extra observations relevant to this slice]
```

When creating a breakdown:

- **Prefer many thin beads over few thick ones** — each should be independently fixable and verifiable
- **Mark blocking relationships honestly** — if bead B genuinely can't be tested until bead A is fixed, say so. If they're independent, mark both as "None — can start immediately"
- **Create beads in dependency order** via `create-task`, then record each blocking relationship with `bd dep add <new-id> <blocker-id> --type blocks`
- **Maximize parallelism** — the goal is that multiple people (or agents) can grab different beads simultaneously

#### Rules for all bead bodies

- **No file paths or line numbers** — these go stale
- **Use the project's domain language** (check `.agent-cortex/ralph/ubiquitous-language.md` if it exists)
- **Describe behaviors, not code** — "the sync service fails to apply the patch" not "applyPatch() throws on line 42"
- **Reproduction steps are mandatory** — if you can't determine them, ask the user
- **Keep it concise** — a developer should be able to read the bead in 30 seconds

After filing, print all bead URLs (with blocking relationships summarized) and ask: "Next bead, or are we done?"

### 5. Continue the session

Keep going until the user says they're done. Each bead is independent — don't batch them.
