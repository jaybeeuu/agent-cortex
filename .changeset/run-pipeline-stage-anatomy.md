---
'@jaybeeuu/agent-cortex': patch
---

Refactor run-pipeline-stage SKILL.md to the canonical anatomy template: add `When to use`, `When NOT to use`, `Workflow`, `Red Flags`, `Common Rationalizations`, `Cross-skill references`, `Examples`, `Philosophy / rationale`, and a `Verification checklist`; add quoted trigger phrases to the description; tokenize subagent dispatch as {{TOOL:task}}. No behavioural change to the stage pipeline — all playbooks, prompts, dispatch rules, and path references are preserved.