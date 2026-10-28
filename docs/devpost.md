# Devpost submission: Settle

**Tagline:** An AI collections agent for freelancers: agreements in, PayPal invoices out, late payments chased and subcontractors paid, with you approving every step.

## Inspiration

Every freelancer we know has the same second job: accounts receivable. You finish the work, then re-type
the agreement into an invoice, set a reminder to check whether it was paid, write the awkward "just
circling back…" email, and when the money finally lands, work out what you owe the designer or developer
who helped. It's tedious, it's emotionally loaded, and it's exactly the part of freelancing that gets
put off, which is how invoices end up 60 days late or never paid.

Agents seemed like a fit for the work, but we didn't want one that emails your clients or moves your
money on its own. So we set ourselves a constraint: the agent does all the thinking and writing, and you
keep one-click control over anything that touches a client or a dollar.

## What it does

- **Agreement → invoice.** Paste a contract, SOW or email thread. Claude extracts the client, line items,
  due date, terms, installment terms and subcontractor splits, and highlights anything it wasn't sure of.
  Review it, then **Approve & send**: Settle creates and sends the invoice with **PayPal Invoicing**.
- **An agent that chases payments politely.** It watches every unpaid invoice and proposes the next step
  on an escalating ladder: a friendly nudge before the due date, a firm reminder once it's late, and a
  **payment plan** at 30+ days or when the client has mentioned cash-flow trouble. Approving the plan
  turns on partial payments (with a sensible minimum) on the live PayPal invoice and sends the client a
  note through PayPal's reminder endpoint.
- **Subcontractor payouts.** When a client pays, in full or in installments, the agent works out each
  subcontractor's proportional share and proposes a single **PayPal Payouts** batch, with a plain-English
  explanation of the split.
- **An approval inbox.** Every proposal shows the invoice, the client, the agent's reasoning and the exact
  message. Approve, edit and approve, or reject. Every agent run is logged with what it looked at and why.
- **A receivables dashboard.** An AG Grid view of what's outstanding, aging buckets, an AI risk score per
  invoice with a one-line reason, and the agent's next action with inline approve/reject. Clicking a row
  shows the invoice's full timeline: created → sent → reminders → partial payments → paid → payouts.

## How we built it

- **Next.js (App Router) + TypeScript + Tailwind**, deployed on **Render** with Postgres (SQLite locally)
  via **Prisma**, and an hourly Render cron that syncs and runs the agent.
- **PayPal REST APIs in the sandbox**, all through one module: OAuth2 with token caching; **Invoicing v2**
  (create, send, remind, full update for partial payments, sync); **Payouts v1** (one batch per approved
  payout, with `sender_batch_id` for idempotency); and **Webhooks**, verified against PayPal's
  verify-webhook-signature endpoint and processed idempotently by event id. A manual *Sync with PayPal*
  uses the same code path, so the demo works without a public URL.
- **Claude** via the Anthropic SDK, always through a single tool with a strict JSON schema, and every
  result re-validated with zod. It's used for extraction, choosing the next action, writing reminder and
  payment-plan messages, risk scoring (cached by a fingerprint of the facts, so it never runs on page
  load), and payout explanations.
- **Rules + model, not model alone.** A small, unit-tested policy decides *whether* an invoice needs
  attention and *which* actions are allowed. Claude only chooses among those and writes the words.
  Money math is plain code.
- **AG Grid Community** for the dashboard and payout history: custom cell renderers, column groups,
  quick search, aging-bucket filters, pinned totals and CSV export.
- **Vitest** suite for split math, agent rules, webhook idempotency and extraction validation, with PayPal
  and Anthropic mocked; it runs on GitHub Actions with lint and typecheck.

## Challenges we ran into

- **Making "the agent proposes, the human approves" airtight.** Overlapping agent runs, double clicks and
  webhook retries all try to create or execute the same thing twice. We ended up with a unique "pending
  key" per invoice, an atomic `PROPOSED → APPROVED` claim before any PayPal call, and idempotency keys on
  the PayPal side.
- **Partial payments and payouts.** If a client pays 43% of an invoice, a subcontractor should get 43%
  of their share now and the rest later, without rounding ever overpaying them. That meant moving from
  "one payout per split" to a payout ledger, and flooring to the cent so the final payment releases
  exactly the remainder.
- **Webhook signature verification.** Re-serializing the event JSON can change bytes and make PayPal's
  verification fail, so we embed the raw request body verbatim.
- **Turning on installments for an invoice that's already been sent** requires a full `PUT` of the
  invoice with read-only fields stripped, not a patch.
- **Keeping the demo honest.** Seed data never touches PayPal, and approving a demo proposal is
  simulated and labelled as such everywhere.

## Accomplishments that we're proud of

- The full loop works end to end in the PayPal sandbox: paste an agreement, send a real invoice, pay it
  as a sandbox buyer, see the payment arrive by webhook, approve the payout, and watch the batch succeed.
- The agent is genuinely useful but can't surprise you: every client email and every payout is
  something you saw and approved, with the reasoning attached.
- The tone ladder. The reminders read like something a considerate person would send.

## What we learned

- The best split between rules and LLM is "rules gate, model writes". It made the agent predictable
  enough to test and still flexible enough to be helpful.
- Strict tool schemas plus a second validation layer remove almost all of the usual "parse the model's
  JSON" pain.
- PayPal's sandbox is complete enough to build and demo a real money workflow (invoicing, partial
  payments, payouts, webhooks) without touching real funds.

## What's next for Settle

- Read replies: connect the inbox so the agent notices "we'll pay Friday" and adjusts.
- Gmail / Google Drive import of agreements, and recurring invoices for retainers.
- Per-client tone preferences and a "never contact this client automatically" switch.
- Multi-user workspaces for agencies, with approval roles.
- Live PayPal (production) mode behind an explicit opt-in.

## Built with

`nextjs` `typescript` `react` `tailwindcss` `prisma` `postgresql` `sqlite` `paypal-invoicing` `paypal-payouts`
`paypal-webhooks` `anthropic` `claude` `ag-grid` `zod` `vitest` `render`
