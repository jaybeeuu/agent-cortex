# Commit signing

GitHub has refused merges here with **"Merging is blocked — Commits must have verified
signatures"**. The instinctive reading — "agents don't sign, so of course" — is wrong:
agent and human commits on this repo are GPG-signed and verified. The unsigned commits
are the ones `github-actions[bot]` writes, and only because `GITHUB_TOKEN` cannot hold a
signing key. This note records what is actually signed, what the API says about
enforcement, and the release policy that follows.

## What is signed, and what is not

The agent environment signs automatically. Global git config has `commit.gpgsign=true`
and the secret key `DF657A88675E4AF8F7D65192A8F2E11DE960BE54` (Josh Bickley-Wallace,
the `noreply` address) is present, so every commit an agent makes is signed without any
per-commit step. Verified against the API:

| Commit | Author | `verification` |
|---|---|---|
| `63f3bef` (PR #181 head) | jaybeeuu | `verified=true reason=valid` |
| `7f99e4c` (PR #182 head) | jaybeeuu | `verified=true reason=valid` |
| `9443f55` (PR #168 head) | github-actions[bot] | `verified=false reason=unsigned` |

`changesets/action` commits as `github-actions[bot]` using `secrets.GITHUB_TOKEN`, and
GitHub does not sign commits made with a token. That is a property of the token, not a
missing configuration step — no amount of workflow YAML changes it.

Landed history looks uniformly `valid` for a different reason: the merge itself re-signs.
`dd347471b1`, the commit that landed PR #161 ("chore: version packages", authored by
`github-actions[bot]`), has `committer=GitHub` and `verification.verified=true
reason=valid`. The bot's unsigned branch commit never reached `main`; the squash commit
GitHub created did, and GitHub signed it.

## What the ruleset API shows — and what it cannot

The enforcing rule is **not visible** to the tokens available here. Read-only probes:

```
$ gh api repos/jaybeeuu/agent-cortex/rules/branches/main --jq '[.[].type]'
["deletion","non_fast_forward","required_linear_history",
 "required_status_checks","pull_request"]
```

Every effective rule on `main` comes from `ruleset_id 22101709` with
`ruleset_source_type: Repository`. There is no `required_signatures` rule in it, and its
`pull_request` parameters allow `["merge","squash","rebase"]`. The other read paths agree:

```
$ gh api repos/jaybeeuu/agent-cortex/branches/main/protection
{"message":"Branch not protected", ... "status":"404"}

$ gh api orgs/jaybeeuu/rulesets
{"message":"Not Found", ... "status":"404"}
```

Two explanations remain, and this note does not choose between them:

1. **An organization-level ruleset enforces signatures.** Org ruleset endpoints require
   organization administration read, which the current token does not hold (scopes:
   `gist, read:org, repo, workflow`), so a `404` here is inconclusive — it may mean "none
   exist" or "you may not see them". Note that the ruleset's `bypass_actors` is empty and
   `current_user_can_bypass` is `"never"`, so repository admin does **not** bypass it.
2. **The UI message was stale** — shown while a signature rule was active, before ruleset
   `22101709` was last updated (2026-09-13).

Resolving this needs a merge attempt, which is a mutation: see the human follow-ups below.

One adjacent rule is worth knowing because it blocks the same merges for an unrelated
reason. Ruleset `22101709` sets `require_extra_approval_for_unattributed_changes: true`,
which demands an extra approval when a PR contains changes GitHub cannot attribute to an
account. A blocked merge box can report that, or the missing `statusCheckRollup` on a
Version Packages PR, without any signature rule being involved.

## Policy: land bot-authored PRs by squash merge

Adopted: **Option A — no unsigned commit is required to land a release.** The release path
already produces a signed commit; the only requirement is the merge method.

Squash-merge Version Packages PRs (`gh pr merge <n> --squash`). GitHub rewrites the bot's
unsigned branch commit into a single commit that it signs as committer, which is exactly
what `dd347471b1` demonstrates. Rebase-and-merge has not been verified here and is not the
documented path. A true merge commit is already impossible: `required_linear_history` is
active on `main`.

Consequence: the release automation stays fully automated and no signing key enters CI.

### Option B, rejected

Importing a GPG key into the release job (`GPG_PRIVATE_KEY` + `GPG_PASSPHRASE` secrets and
a `git commit --amend -S` step) would make the *branch* commit signed too. It is rejected
because it buys nothing the squash merge does not already give — the branch commit is
discarded on merge — while placing a long-lived private key in repository secrets. If it is
ever revisited, the same change must carry an access audit (who and what can read the
secret) and a rotation procedure (key expiry, re-issue, revocation). Neither exists today,
and adding the key without them is not acceptable.

## When the signature check fires

| Situation | Remedy |
|---|---|
| Bot-authored PR blocked on signatures | Squash-merge it. GitHub re-signs; no branch rewrite needed. |
| An agent commit is reported unsigned | Check `git config --get commit.gpgsign` and `gpg --list-secret-keys`; re-sign with `git commit --amend -S --no-edit` and force-push the branch. |
| The block persists with no visible cause | Read `gh api repos/<owner>/<repo>/rules/branches/<branch>`; if no `required_signatures` rule is listed, the enforcing rule sits at organization level — ask an org admin rather than guessing. |

## Human-only follow-ups

These need repository or organization settings and cannot be done by an agent:

- **Merge probe.** Run `gh pr merge 168 --squash` (or `PUT /repos/jaybeeuu/agent-cortex/pulls/168/merge`)
  and record the verbatim error. This resolves the contradiction above: a signature error
  confirms an invisible rule; a status-check error confirms the message was stale.
- **Inspect org rulesets.** Open `https://github.com/organizations/jaybeeuu/settings/rules`
  and confirm whether a ruleset targets `jaybeeuu/agent-cortex` with "Require signed
  commits". Record the answer here.
- **Confirm the merge method.** If squash-merge is the documented path, consider removing
  `rebase` from `allowed_merge_methods` so a rebase merge cannot replay an unsigned bot
  commit onto `main`.
