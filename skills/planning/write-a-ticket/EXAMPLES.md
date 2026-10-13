# Write a Ticket — Examples

Worked before/after rewrites for the `write-a-ticket` skill.

## A whole ticket: padded vs tight

The padded version is the failure mode this skill exists to prevent: it explains the RFC,
prescribes an implementation, says nothing about scope, and leaves a question open. The
tight version points at the source material, states the behaviour, draws the boundary, and
gives an entry point.

### Padded

```markdown
## Context

We are moving our billing stack to a new provider. The current provider has had several
outages this year, which has affected customer trust. The Q3 billing review evaluated
Stripe, Paddle, and Chargebee; Paddle was chosen because of EU data residency. The
meeting notes are attached. There was also discussion about whether to migrate in one go
or incrementally, and about how to handle existing subscriptions.

## Description

We need to migrate to Paddle. This involves adding the Paddle SDK, creating a webhook
handler, migrating the subscription records, updating the pricing page, and changing the
retry logic. Step 1: install the SDK. Step 2: add a webhook handler that verifies the
signature. Step 3: write a migration script …

## In scope

- The migration

## Acceptance criteria

- [ ] The migration works correctly
- [ ] The feature is tested
- [ ] Payments still work

## Open questions

- Do we migrate annual subscriptions too, or only monthly?
```

### Tight

```markdown
## Context

Part of the billing migration epic (BILL-412). Approach and provider decision in
RFC-018 §2; retry policy in ADR-014. Depends on the Paddle webhook receiver (BILL-420).

## Description

When a Paddle webhook fails with a transient error, the handler retries with the shared
backoff policy. Non-transient failures are logged and acknowledged without retry. The
existing provider path is unchanged.

## In scope

- Retry of transient Paddle webhook failures with the shared backoff policy.
- Provider selection in the payment factory.
- Structured logging of terminal webhook failures.

## Out of scope

- Subscription record migration (BILL-421).
- Pricing-page changes (BILL-422).
- Provider cutover and production enablement.

## Acceptance criteria

- [ ] A webhook returning 503 is retried up to 3 times with exponential backoff.
- [ ] A webhook returning 422 is not retried and is logged with the payload.
- [ ] The retry counter is per webhook event, not per process.
- [ ] The existing Stripe retry specs pass unchanged.

## Testing approach

Integration spec in `test/webhooks/retry.spec.ts` against the Paddle sandbox, asserting
the 503-then-200 path and the terminal 422 path.

## Technical notes

- **Entry point:** `src/payments/paddle.ts:41` (`handleWebhook`, `shouldRetry`)
- `retry()` from `@acme/retry-utils`; follow `src/payments/stripe.ts` for the handler shape.
- `handleWebhook` becomes async — update its call site in `src/payments/index.ts:12`.
```

The tight version is shorter, answers the reviewer's questions, and still leaves the
implementation to the implementer.

## Description: states the goal vs explains the RFC

| Instead of… | Write… |
| "We need to migrate to Paddle. The provider was chosen after a review of Stripe, Paddle and Chargebee, and there was discussion about whether to migrate incrementally. This ticket covers the retry logic, which is important because outages cost us customers. Step 1: …" | "When a Paddle webhook fails with a transient error, the handler retries with the shared backoff policy. Non-transient failures are logged and acknowledged without retry." |

The Description states what the ticket does and the behaviour it produces. It leads into the
scope bullets — the RFC link and the deliberation stay in Context or the source document.

## Padded context vs linked context

| Instead of… | Write… |
| "We are moving to a new billing provider because the current one has outages. The provider was chosen in the Q3 billing review (attached meeting notes, see thread in #billing where we discussed Stripe vs Paddle vs Chargebee; conclusion was Paddle due to EU data residency). This ticket tracks the work agreed there." | "Part of the billing migration epic (BILL-412). Approach in RFC-018 §2. Depends on the Paddle webhook receiver (BILL-420)." |

Context is a pointer block: parent, where the approach lives, what it depends on. It does
not recap the deliberation.

## Vague vs verifiable acceptance criteria

| Instead of… | Write… |
| "The export works correctly" | "Given a workspace with 1,000 issues, the CSV export returns all rows with no truncation" |
| "The feature is tested" | "Unit tests cover the retry path for transient HTTP 503 responses" |
| "The migration runs" | "The migration completes without errors on a staging copy of the production database" |

## Technical notes: entry point vs full inventory

| Instead of… | Write… |
| "Step 1: install the SDK via `pnpm add @acme/paddle`. Step 2: add a webhook handler that verifies the signature and … (10 more steps)" | "- **Entry point:** `src/payments/paddle.ts:41` (`handleWebhook`, `shouldRetry`)" |
| "Files to change: `paddle.ts`, `index.ts`, `stripe.ts`, `retry.ts`, `types.ts`, `webhook.ts`, `config.ts`" | "- **Entry point:** `src/payments/paddle.ts:41` (`handleWebhook`, `shouldRetry`)<br>- Follow `src/payments/stripe.ts` for the handler shape." |

Technical notes lead with the entry point and then give only the facts that change how the
work is done — a signature, a library, a convention. They are neither an inventory of every
file touched nor a step-by-step guide; either of those means the ticket has become the code.

## Open questions: agreed vs smuggled

An open question is legitimate when the human has agreed to it: it goes under
`Open questions` with the owner of the answer. A question the human has not agreed to is a
red flag wherever it appears — resolve it, spike it, or ask.

| Instead of… | Write… |
| A question buried in `Technical notes` or a `Notes` section, with no owner and no agreement | "## Open questions<br>- Do annual subscriptions migrate too? (owner: Priya)" |
