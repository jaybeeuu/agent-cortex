---
name: handoff
description: Compact the current conversation into a handoff document for another agent to pick up.
argument-hint: "What will the next session be used for?"
---

Write a handoff document summarising the current conversation so a fresh agent can continue the work. Save to the temporary directory of the user's OS - not the current workspace.

Include a "suggested skills" section in the document, which suggests skills that the agent should invoke.

Do not duplicate content already captured in other artifacts (PRDs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.

Redact any sensitive information, such as API keys, passwords, or personally identifiable information.

If the user passed arguments, treat them as a description of what the next session will focus on and tailor the doc accordingly.

## Output a starter prompt

As the last section of the document, include a `## Starter prompt` section containing a ready-to-paste prompt the user can give the next session. The prompt must:

1. Point the new session at the handoff document itself by absolute path.
2. State the focus of the next session in one or two sentences.
3. Tell the new session to read the handoff first, then the referenced artifacts it needs, before acting.
4. Ask the new session to clean up any provisional/test artifacts the handoff documents (e.g. prototype beads created during the session) unless the handoff says otherwise.
5. Stay under ~150 words so it can be pasted verbatim as the first message.

The point of the starter prompt is to give the next session a minimal-context start: everything it needs lives in the handoff document and the artifacts it references, so the first message can be short.