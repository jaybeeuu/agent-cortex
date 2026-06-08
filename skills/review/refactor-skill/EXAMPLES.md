# Examples

## Template comparison output shape

The output of Step 2 (template comparison) drives the whole rewrite. Below is a compact before/after table showing what the comparison output looks like for a typical skill being refactored.

```
Skill: review-security

| Dimension | Current state | Template says | Verdict |
|---|---|---|---|
| Front matter | name: review-security, no description field | name, description required | Partial — add description |
| Description | Missing entirely | 2 sentences, Use when ..., 2-4 triggers | Missing — add |
| When to use | Single sentence | Trigger phrases listed explicitly | Needs rewording |
| Workflow | 2 prose paragraphs | Numbered steps with outcomes | Needs restructuring |
| Verification checklist | Missing | Required section | Missing — add |
| Line length | 45 lines | ~150 target, 150 hard cap | Under — room to expand |
```

The same structure applies to any skill. Dimensions that already align can be noted as "Aligned — no change needed", keeping the comparison honest rather than gap-focused.
