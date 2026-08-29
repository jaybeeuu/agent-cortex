# Write a Ticket — Examples

Worked before/after rewrites for the `write-a-ticket` skill.

## Vague vs verifiable acceptance criteria

| Instead of… | Write… |
|---|---|
| "The export works correctly" | "Given a workspace with 1,000 issues, the CSV export returns all rows with no truncation" |
| "The feature is tested" | "Unit tests cover the retry path for transient HTTP 503 responses" |
| "The migration runs" | "The migration completes without errors on a staging copy of the production database" |

## Padded Context vs linked Context

| Instead of… | Write… |
|---|---|
| "We are moving to a new billing provider because the current one has outages. The provider was chosen in the Q3 billing review (attached meeting notes, see thread in #billing where we discussed Stripe vs Paddle vs Chargebee; conclusion was Paddle due to EU data residency). This ticket tracks the work agreed there." | "We are migrating payment processing to Paddle for EU data residency, as agreed in the billing RFC (link). This ticket tracks the migration." |

A Context section sets the scene in one to three sentences and links the source of truth. It does not recap the deliberation.

## Technical notes: pointer, not design

| Instead of… | Write… |
|---|---|
| "Step 1: install the SDK via `npm i @acme/paddle` … Step 2: add a webhook handler that … (10 more steps)" | "Webhook signature verification lives at `src/payments/paddle.ts`; the agreed event schema is in the billing RFC. Follow the existing `stripe.ts` handler structure." |

Technical notes point at where to look and what was already decided. A step-by-step implementation guide belongs in implementation, not in a ticket.