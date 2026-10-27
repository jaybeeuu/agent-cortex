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

Landed history looks uniformly `valid` for a different reason: the commit the merge creates
is signed by GitHub. `dd347471b1`, the commit that landed PR #161 ("chore: version
packages", authored by `github-actions[bot]`), has `committer=GitHub` and
`verification.verified=true reason=valid`. The bot's unsigned branch commit never reached
`main`; the squash commit GitHub created did, and GitHub signed it.

That is what this repository's history proves, and it is all it proves. It does **not**
prove that a squash merge escapes an *enforced* signature rule.

## Squash does not bypass an enforced signature rule

The landing commit being GitHub-signed does not exempt the pull request from the check:
a ruleset that requires signatures inspects the head-branch commits too. GitHub's ruleset
reference, "Require signed commits":

> When GitHub evaluates whether a pull request can be merged, it creates a test merge commit
> whose parents are the latest commit on the base branch and the pull request's head commit.
> GitHub checks the commits introduced by this test merge, including commits from the head
> branch. As a result, unsigned commits on the head branch can block a squash merge, even
> though GitHub would sign the final squash commit. This restriction can also apply to the
> author of the pull request.

and the remedy it documents:

> To merge a blocked pull request, rewrite and sign the unsigned commits on the head branch,
> or ask someone with permission to bypass the applicable protections to merge the pull
> request.

So "squash it and let GitHub re-sign" is not a way *around* the check — it is only the reason
landed history reads `valid` when no signature rule is in force. If a signature rule is
enforced, the remedy is a signed commit, not a different merge method.

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

Two explanations remain, and this note does not choose between them — though the evidence
in *The enforcing rule: still open (AC1)* below narrows the first one to an
organization-level rule only:

1. **An organization-level ruleset enforces signatures.** Org ruleset endpoints require
   organization administration read, which the current token does not hold (scopes:
   `gist, read:org, repo, workflow`), so a `404` here is inconclusive — it may mean "none
   exist" or "you may not see them". Note that the ruleset's `bypass_actors` is empty and
   `current_user_can_bypass` is `"never"`, so repository admin does **not** bypass it.
2. **The UI message was stale** — shown while a signature rule was active, before ruleset
   `22101709` was last updated (2026-09-13).

Closing this out needs a merge attempt (a mutation) or org-admin access: see *The enforcing
rule: still open (AC1)* and the human follow-ups below.

One adjacent rule is worth knowing because it blocks the same merges for an unrelated
reason. Ruleset `22101709` sets `require_extra_approval_for_unattributed_changes: true`,
which demands an extra approval when a PR contains changes GitHub cannot attribute to an
account. A blocked merge box can report that, or the missing `statusCheckRollup` on a
Version Packages PR, without any signature rule being involved.

## Policy: land bot-authored PRs by squash merge

Adopted: **Option A — no signing key in CI.** So long as no signature rule is enforced, no
unsigned commit is required to land a release: the merge produces a commit GitHub signs, so
the only requirement is the merge method.

Squash-merge Version Packages PRs (`gh pr merge <n> --squash`). GitHub rewrites the bot's
unsigned branch commit into a single commit that it signs as committer, which is exactly
what `dd347471b1` demonstrates. Squash is also the only path: `allow_merge_commit` is
`false` in the repository merge settings, which alone makes a true merge commit impossible,
and `required_linear_history` on `main` independently restricts merges to squash or rebase.
Rebase-and-merge has not been verified here, is not the documented path, and is the method
that would replay the unsigned commit onto `main`.

Note the limit of this remedy: squash re-signs the landing commit, it does not bypass an
enforced signature rule (see above). It works here because no such rule is currently
enforced against this repository.

Consequence: the release automation stays fully automated and no signing key enters CI —
provided no signature rule is enforced. See the contingency below.

### Contingency: the enforcing rule turns out to be real at organization level

The policy above holds only while a squash merge is permitted. If the merge probe or an org
admin confirms an organization-level `required_signatures` rule, Option A's premise fails:
GitHub would then refuse the squash merge as well, because it validates the pull request's
head commits through the test merge. In that case:

1. Do not keep re-attempting the squash merge, and do not treat a bypass as the workaround —
   a bypass is a human permission decision, not a release path.
2. The release path must produce signed commits, which means Option B (import a key into the
   release job) or having a key-holding actor sign the release commit. That change must land
   with the access audit and rotation procedure Option B requires.
3. Until then, releasing is a human step performed with bypass permission, recorded as a
   HITL note on the bead.

The state of the rule is not observable from a repository-scoped token, so re-check it
before assuming it is absent.

### Option B, rejected as the default

Importing a GPG key into the release job (`GPG_PRIVATE_KEY` + `GPG_PASSPHRASE` secrets and
a `git commit --amend -S` step) would make the *branch* commit signed too. It is rejected as
the default because, while no signature rule is enforced, it buys nothing the squash merge
does not already give — the branch commit is discarded on merge — while placing a
long-lived private key in repository secrets. That trade-off inverts if a signature rule is
confirmed enforced: Option B then becomes necessary (see the contingency above). Either way,
if it is revisited the same change must carry an access audit (who and what can read the
secret) and a rotation procedure (key expiry, re-issue, revocation). Neither exists today,
and adding the key without them is not acceptable.

## When the signature check fires

| Situation | Remedy |
|---|---|
| Bot-authored PR blocked on signatures, rule **confirmed** enforced | A squash merge will not help — GitHub checks head-branch commits through its test merge. Rewrite the branch so its commits are signed (`git rebase --exec 'git commit --amend -S --no-edit'` or an amend plus force-push), then merge; otherwise a person with bypass permission merges it. |
| Bot-authored PR blocked, no signature rule visible in `rules/branches/main` | The block is most likely not signatures. Read the merge box first: missing required status checks (an empty `statusCheckRollup` on a Version Packages PR is the common case) or a missing code-owner review fully explain `mergeStateStatus=BLOCKED`. |
| An agent commit is reported unsigned | Check `git config --get commit.gpgsign` and `gpg --list-secret-keys`; re-sign with `git commit --amend -S --no-edit` and force-push the branch. |
| The block persists with no visible cause | Read `gh api repos/<owner>/<repo>/rules/branches/<branch>`; if no `required_signatures` rule is listed, the enforcing rule — if any — sits at organization level and is unreadable from here: ask an org admin rather than guessing. |

## The enforcing rule: still open (AC1)

The parent bead's first acceptance criterion — "Enforcing rule identified, or the UI message
shown to be stale — with the merge API's error text quoted either way" — is **open**. No
merge API error text exists yet, because obtaining it requires a merge attempt, which is a
mutation and therefore a human step. Read-only evidence narrows the question sharply but
does not close it:

1. **No repository-level signature rule was blocking on 2026-10-13.** PR #161's head
   `fe7ef84` is `verification.verified=false reason=unsigned`, and the PR was squash-merged
   at `2026-10-13T21:46:06Z` — after ruleset `22101709`'s last update
   (`2026-09-13T21:11:23Z`). An unsigned head landed after the ruleset's last edit, so
   neither that ruleset nor anything older in it enforced signatures then.
2. **PR #168's current block needs no signature rule to explain it.**
   `gh pr view 168 --json state,mergeable,mergeStateStatus,statusCheckRollup,reviews` returns
   `state=OPEN`, `mergeable=MERGEABLE`, `mergeStateStatus=BLOCKED`,
   `statusCheckRollup=[]`, `reviews=[]`. All five required checks (`Test`, `Lint`,
   `Claude plugin materialiser check`, `Changeset check`, `Setup`) are unreported, and
   `require_code_owner_review` is on with no reviews. `required_status_checks` plus the
   missing code-owner review fully account for `BLOCKED`.
3. **The residual question is only whether an organization-level rule is enforced.** Org
   rulesets cannot be read with the current token — `gh api orgs/jaybeeuu` itself returns
   `{"message":"Not Found", ... "status":"404"}` with
   `gh: This API operation needs the "admin:org" scope`. Organization rulesets are therefore
   **unreadable, not proven absent**, and `rules/branches/main` cannot rule them out because
   it only reports repository-level rules.

Status: **open, pending a human merge probe or org-admin inspection** (see below).

## Human-only follow-ups

These need repository or organization settings and cannot be done by an agent:

- **Merge probe — closes AC1.** Run `gh pr merge 168 --squash` (or
  `PUT /repos/jaybeeuu/agent-cortex/pulls/168/merge`) and record the verbatim error text
  here. A signature error confirms an invisible rule and triggers the contingency above; a
  status-check error confirms the message was stale and closes the criterion as
  "UI message stale".
- **Inspect org rulesets.** Open `https://github.com/organizations/jaybeeuu/settings/rules`
  and confirm whether a ruleset targets `jaybeeuu/agent-cortex` with "Require signed
  commits". Record the answer here.
- **Confirm the merge method.** If squash-merge is the documented path, consider removing
  `rebase` from `allowed_merge_methods` so a rebase merge cannot replay an unsigned bot
  commit onto `main`.
