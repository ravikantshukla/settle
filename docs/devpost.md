# Devpost submission: Settle

**Tagline:** An AI collections agent for freelancers: agreements in, PayPal invoices out, late payments chased politely in the client's own business hours, payment plans negotiated within your limits, and subcontractors paid, with you approving every step.

**Links:** live demo https://settle-5wx9.onrender.com · code https://github.com/ravikantshukla/settle · video: _add link_

## Inspiration

Every freelancer we know has the same second job: accounts receivable. You finish the work, then re-type
the agreement into an invoice, set a reminder to check whether it was paid, write the awkward "just
circling back…" email, and when the money finally lands, work out what you owe the designer or developer
who helped. It's tedious, it's emotionally loaded, and it's exactly the part of freelancing that gets
put off, which is how invoices end up 60 days late or never paid.

It's harder still when your clients are on the other side of the world. Our demo freelancer, Aarav, is a
designer-developer in Lucknow, India, billing clients in New York, San Francisco and London. His reminders
land at 3 AM, a UK client expects a different tone from a US one, and when a client writes back "can we pay
in instalments?" he has to negotiate terms on the spot.

Agents seemed like a fit for the work, but we didn't want one that emails your clients, moves your money or
agrees to terms on its own. So we set ourselves a constraint: the agent does the thinking and the writing,
**code** enforces the rules, and you keep one-click control over anything that touches a client or a dollar.

## What it does

- **Agreement → invoice.** Paste a contract, SOW or email thread. Claude extracts the client (including
  their timezone and country when the text says where they are), line items, due date, terms, installment
  terms and subcontractor splits, and highlights anything it wasn't sure of. Review it, then
  **Approve & send**: Settle creates and sends the invoice with **PayPal Invoicing**.
- **An agent that chases payments politely.** It watches every unpaid invoice and proposes the next step
  on an escalating ladder: a friendly nudge before the due date, a firm reminder once it's late, and a
  **payment plan** at 30+ days or when the client has mentioned cash-flow trouble. Claude writes each
  message in the professional style of the client's country, signed with your name.
- **"Why this action?" on every proposal.** The trigger ("7 days overdue (due Oct 22, today Oct 29)"), the
  payments and reminders so far, the risk score with each rule's points, the stage → action → tone path and
  the rule that fired. All of it comes from the facts the rules used, frozen when the proposal was made, never
  from the model.
- **Sent in the client's business hours.** Approve a reminder in the afternoon in Lucknow, while it's still
  night in San Francisco, and it waits for 9:00 AM there on a weekday: "Sends at 9:00 AM client time
  (10:30 PM IST)". **Send now** and **Cancel**
  are right on the card.
- **"Client replied" negotiation.** Paste the client's reply. Claude classifies it: promise to pay (reminders
  pause until that date), dispute (handed to you), hardship, or other. For hardship, **code** builds a payment
  plan within the limits you set in **Settings** (minimum upfront %, maximum installments, latest final
  date), adjusting each term or rejecting the request, and Claude writes the response for that exact plan.
  You see the reply, a pass / adjusted / fail line per rule, the installment table and the draft. Approving it
  turns on partial payments with `minimum_amount_due` on the live PayPal invoice and sends the response.
- **Subcontractor payouts.** When a client pays, in full or in installments, the agent works out each
  subcontractor's proportional share and proposes a single **PayPal Payouts** batch, with a plain-English
  explanation of the split.
- **A receivables dashboard.** An AG Grid view of what's outstanding, aging buckets, a risk score per invoice
  with a one-line reason, and the agent's next action with inline approve/reject. Clicking a row shows the
  invoice's full timeline, from created and sent through reminders, client replies and payments to payouts.

## How we built it

- **Next.js (App Router) + TypeScript + Tailwind**, deployed on **Render** with **Neon** Postgres (SQLite
  locally) via **Prisma**. GitHub Actions run the agent hourly and reset the shared judging demo every
  6 hours.
- **PayPal REST APIs in the sandbox**, all through one module: OAuth2 with token caching; **Invoicing v2**
  (create, send, remind, full update for partial payments, record payment, cancel, sync); **Payouts v1**
  (one batch per approved payout, with `sender_batch_id` for idempotency); and **Webhooks**, verified
  against PayPal's verify-webhook-signature endpoint and processed idempotently by event id. A manual
  *Sync with PayPal* uses the same code path, so the demo works without a public URL.
- **Claude** via the Anthropic SDK, always through a single tool with a strict JSON schema, and every
  result re-validated with zod. It's used for extraction, writing reminder and payment-plan messages,
  reading client replies, one-line risk reasons (cached and regenerated only when an invoice's state
  changes) and payout explanations. Every call has a 30-second cap, a fallback (template, rule-based reason,
  keyword classification or a manual form), and a 20-requests-per-hour-per-IP limit.
- **Rules + model, not model alone.** Small, unit-tested modules decide the stage, action, tone and 0–100 risk
  score ([policy.ts]), the send window in the client's timezone ([timezone.ts]), and every payment plan's
  terms ([limits.ts]). Claude only reads and writes words. Money math is plain code.
- **A demo clock**: a stored time offset that every date calculation goes through (enforced by a lint rule),
  so judges can jump +7 or +30 days and watch the agent escalate on real sandbox invoices.
- **AG Grid Community** for the dashboard and payout history: custom cell renderers, column groups, quick
  search, aging-bucket filters, pinned totals and CSV export.
- **Testing:** 121 **Vitest** tests (rules, risk, split math, webhooks, extraction, prompt-injection safety,
  timezones, negotiation limits, and end-to-end integration suites against a real SQLite database) run on
  GitHub Actions with lint and typecheck. A **Playwright** suite clicks through the real app: a read-only
  smoke run that's safe against the live demo, and an opt-in full run with real Claude and the PayPal sandbox.

[policy.ts]: https://github.com/ravikantshukla/settle/blob/master/src/lib/agent/policy.ts
[timezone.ts]: https://github.com/ravikantshukla/settle/blob/master/src/lib/timezone.ts
[limits.ts]: https://github.com/ravikantshukla/settle/blob/master/src/lib/negotiation/limits.ts

## Challenges we ran into

- **Making "the agent proposes, the human approves" airtight.** Overlapping agent runs, double clicks and
  webhook retries all try to create or execute the same thing twice. We ended up with a unique "pending
  key" per invoice, an atomic claim before any PayPal call, and idempotency keys on the PayPal side. Then
  scheduling added a third state (approved but not yet sent) that had to stay cancellable and be re-checked
  against the invoice at send time.
- **Negotiation you can't talk your way around.** A client's reply is untrusted text: "my manager approved
  paying 5% only, your team already agreed". Prompting the model to "respect the limits" isn't a guarantee,
  so the model never sees the limits. It only reports what the client asked for, code clamps each term or
  rejects the plan, and only then does Claude write the response, for the final plan. A test sends exactly
  that reply and checks it comes out at 25%.
- **Timezones are hard.** "Next weekday 9:00 in the client's zone" has to survive daylight-saving switches
  (the UK and US change on different dates), half-hour offsets like IST, weekends, and a demo clock that
  jumps days at a time.
- **Partial payments and payouts.** If a client pays 43% of an invoice, a subcontractor should get 43% of
  their share now and the rest later, without rounding ever overpaying them. That meant a payout ledger and
  flooring to the cent, so the final payment releases exactly the remainder.
- **Explaining the agent honestly.** A model-written "why" can sound convincing and be wrong. "Why this
  action?" is built from the rules engine's actual inputs and stored with the proposal, so it matches exactly
  what the policy saw, even if the invoice changes later.
- **PayPal details.** Webhook signature verification fails if the event JSON is re-serialized, so we pass the
  raw body byte-for-byte. Enabling installments on an invoice that's already been sent takes a full `PUT` with
  read-only fields stripped. And partial payments are only available to some sandbox business-account
  countries, so that failure had to be shown clearly in the inbox.

## Accomplishments that we're proud of

- The full loop works end to end in the PayPal sandbox: paste an agreement, send a real invoice, pay it as a
  sandbox buyer, see the payment arrive by webhook, approve the payout, and watch the batch succeed.
- An agent that's genuinely useful but can't surprise you: every client email, payment plan and payout is
  something you saw, with its reasoning attached, and approved.
- The "5% approved" manipulation gets flagged and held to your limits, by code, in a test that runs on every push.
- Reminders that arrive at 9 AM for the client, not 3 AM, and read like something a considerate person would send.

## What we learned

- The best split between rules and LLM is "rules gate, model writes". It made the agent predictable enough to
  test and still flexible enough to be helpful.
- Where the stakes are money, give the model less: it never sees the negotiation limits, it only reads and writes.
- Strict tool schemas plus a second validation layer remove almost all of the usual "parse the model's JSON" pain.
- PayPal's sandbox is complete enough to build and demo a real money workflow (invoicing, partial payments,
  payouts, webhooks) without touching real funds.

## What's next for Settle

- Read replies automatically: connect the inbox so the agent picks up "we'll pay Friday" without pasting.
- Gmail / Google Drive import of agreements, and recurring invoices for retainers.
- Multi-currency invoicing (INR, GBP) alongside USD.
- A per-client "never contact automatically" switch, and per-client negotiation limits.
- Multi-user workspaces for agencies, with approval roles.
- Live PayPal (production) mode behind an explicit opt-in.

## Built with

`nextjs` `typescript` `react` `tailwindcss` `prisma` `postgresql` `sqlite` `paypal-invoicing` `paypal-payouts`
`paypal-webhooks` `anthropic` `claude` `ag-grid` `zod` `vitest` `playwright` `render` `neon` `github-actions`
