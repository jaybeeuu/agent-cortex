---
name: review-security
description: Scans git changes for leaked secrets, credentials, and tokens using gitleaks. Use when you need to "check for secrets", "scan for credentials", or "review security" before committing.
---

# Review Security

## When to use

- Before any commit — scan staged changes for secrets.
- During code review — scan the most recent commit.
- Asked to "check for secrets", "scan for credentials", or "review security".

## When NOT to use

- Auditing dependency vulnerabilities or supply-chain security — gitleaks scans your code, not your dependencies.
- Reviewing authentication or authorisation logic — use a manual code review instead.
- Scanning an entire repository history for the first time — run `gitleaks detect --full` separately; this skill is for incremental scans.

## Philosophy / rationale

- **Automated scanning catches what manual review misses.** A secret committed to git is there forever — even if you remove it later, it lives in history.
- **Staged scans are the cheapest catch point.** Scanning before commit costs seconds. Cleaning up after a push costs hours and involves the whole team.
- **Gitleaks runs locally without sending code to a third party.** Your code never leaves your machine.

## Workflow

### 1. Verify gitleaks is installed

```bash
gitleaks version
```

If the command fails, gitleaks is not installed. Inform the user and offer to install it:

```bash
bash "$(find ~ -path '*/agent-cortex/skills/review-security/scripts/install-gitleaks.sh' 2>/dev/null | head -1)"
```

### 2. Determine the scan scope

| Situation | Command |
|---|---|
| Staged changes (before committing) | `gitleaks protect --staged -v` |
| Most recent commit (after committing, e.g. during review) | `gitleaks detect --log-opts "HEAD~1..HEAD" -v` |
| Specific ref range | `gitleaks detect --log-opts "<from>..<to>" -v` |

### 3. Run the scan and interpret the verdict

- Exit `0` — **PASS**. No secrets found. Proceed.
- Exit `1` — **FAIL**. Findings are printed with file, line, and rule name.

### 4. Handle failures

If the verdict is FAIL, report each finding as a required change. Do not proceed until secrets are removed.

When running within a ralph review pipeline, the outcome is communicated through the `---REPORT---` block that ralph parses — set `REVIEW_OUTCOME: CHANGES_REQUESTED` in that block and list each finding under `CHANGES_REQUESTED` (see the review template at `skills/create-task/templates/review.md`).

## Red Flags

- **Skipping the scan because "it is just documentation".** Secrets leak in docs, config examples, and READMEs just as easily as in code.
- **Dismissing a finding without verifying.** Always check the context before marking a finding as a false positive.
- **Scanning after pushing instead of before.** Once pushed, the secret is on the remote. Even a force push may not fully remove it from history.

## Common Rationalizations

| Rationalization | Rebuttal |
|---|---|
| "I will check for secrets manually" | Manual review has blind spots. Gitleaks catches patterns you will scroll past. |
| "This is just a config file" | Config files are where secrets most commonly live. |
| "I will scan before pushing, not before committing" | The earlier you catch it, the cheaper it is. Pre-commit scan costs two seconds. |
| "This is a false positive" | It might be. Verify the context before dismissing it. |

## Cross-skill references

| When you need… | Use this skill |
|---|---|
| Code conventions that help avoid embedding secrets | `style-code` |
| Documentation conventions that keep examples secret-free | `style-documentation` |

## Examples

### Reading a FAIL finding

```
Finding:     detected AWS Access Key ID
Rule:        aws-access-key-id
File:        deploy/config.ts
Line:        42
Secret:      AKIA************
```

Each finding includes the rule that caught it, the file and line, and the matched secret. Investigate to confirm or dismiss.

### Staged scan catches before it is too late

| Instead of… | Write… |
|---|---|
| Committing `config.ts` with a hardcoded API key, pushing, then realising | Running `gitleaks protect --staged` before commit, catching the key in the staged diff |

## Verification checklist

- [ ] Gitleaks is installed and available
- [ ] Appropriate scan scope selected (staged, commit, or ref range)
- [ ] Scan run and verdict recorded
- [ ] Every FAIL finding investigated and resolved
- [ ] No commit pushed with unresolved secrets
