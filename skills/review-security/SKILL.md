---
name: review-security
description: Scan git changes for leaked secrets, credentials, and tokens in code and documentation. Use before committing, during code review, or when asked to check for security issues or secrets.
---

# Review Security

Scan git changes for secrets using **gitleaks**.

## Check for gitleaks

```bash
gitleaks version
```

If the command fails, gitleaks is not installed. Inform the user:

> `gitleaks` is not installed. It is required to run the security scan. Would you like me to install it?

If the user agrees, run the install script:

```bash
bash <path-to-plugin>/skills/review-security/scripts/install-gitleaks.sh
```

Find the script with:

```bash
find ~ -path "*/agent-nexus/skills/review-security/scripts/install-gitleaks.sh" 2>/dev/null | head -1
```

## Running the Scan

**Staged changes** (before committing):
```bash
gitleaks protect --staged -v
```

**Most recent commit** (after committing, e.g. during ralph review stage):
```bash
gitleaks detect --log-opts "HEAD~1..HEAD" -v
```

**Specific ref range:**
```bash
gitleaks detect --log-opts "<from>..<to>" -v
```

## Verdict

- Exit `0` — **PASS**. No secrets found.
- Exit `1` — **FAIL**. Findings are printed with file, line, and rule name.

## When Reviewing for Ralph

If the verdict is FAIL, set `REVIEW_OUTCOME: CHANGES_REQUESTED` immediately and list each gitleaks finding as a required change. Do not proceed with the quality review until secrets are removed.

