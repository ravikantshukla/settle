# Settle

AI collections agent for freelancers and small agencies. Built for the PayPal AI Hackathon (deadline 2026-11-12).

## Product

1. The user pastes a project agreement or email thread.
2. AI extracts client, line items, due dates and subcontractor splits, and drafts a PayPal invoice.
3. The user reviews/edits, approves, and the invoice is sent via PayPal Invoicing.
4. An agent monitors unpaid invoices and proposes:
   - AI-written reminders (sent through PayPal's invoice remind endpoint),
   - partial-payment plans,
   - PayPal Payouts to subcontractors for their share once an invoice is paid.
5. Every money-moving or client-facing action requires one-click human approval.
6. A dashboard (AG Grid) shows receivables, aging, risk, and the agent's next proposed action.

## Stack

- Next.js (App Router) + TypeScript + Tailwind CSS
- Prisma ORM — SQLite locally, Postgres in production (Render)
- PayPal REST APIs via `fetch` (sandbox): OAuth2, Invoicing v2, Payouts v1, Webhooks
- Anthropic SDK (`@anthropic-ai/sdk`); model name comes from `ANTHROPIC_MODEL`, never hard-coded
- AG Grid Community (`ag-grid-react`) for tables
- zod for validating AI output and API input
- Deploy target: Render

## Folder conventions

```
src/
  app/              Next.js routes (pages + route handlers under app/api/*)
  components/       Shared React components (client components marked "use client")
  lib/
    paypal/         The ONLY place that talks to PayPal (auth, invoicing, payouts, webhooks)
    ai/             Anthropic client + prompt/tool definitions (extraction, reminder drafting)
    agent/          Agent: policy.ts (pure rules), runAgent, proposePayout, executeAction (the only
                    path from an approved proposal to PayPal), payoutShares.ts (pure split math)
    payouts/        Payout rows <-> PayPal payout items (shared by execution, webhook, sync)
    invoices/       Invoice domain logic: shared zod schemas, send flow, PayPal sync + webhook handling
    db/             Prisma client singleton and DB helpers (`num()` converts Prisma Decimals)
prisma/             schema.prisma + migrations (SQLite), postgres/ (generated schema + Postgres migrations), seed.ts
scripts/            One-off / smoke-test scripts run with tsx
docs/               Developer docs (webhooks, deployment)
render.yaml         Render Blueprint (web service; DB on Neon; hourly agent via .github/workflows/agent-cron.yml)
```

- Import with the `@/` alias (`@/lib/paypal/...`).
- Server-only modules (`lib/paypal`, `lib/ai`, `lib/db`) must never be imported from client components.

## Rules

- **Never commit secrets.** Real values live in `.env` / `.env.local` (git-ignored). Only `.env.example` is committed, with empty or placeholder values.
- **All PayPal calls go through `src/lib/paypal`.** No `fetch` to PayPal from routes, components, or the agent directly.
- **Human approval for side effects.** Any agent action that moves money or contacts a client (sending invoices, reminders, payment plans, payouts) must first be persisted as an `AgentAction` with status `PROPOSED`; it is executed only after a human approves it. Directly user-initiated actions (e.g. clicking "Approve & send") are recorded as `AgentAction`s too, for the audit trail.
- **Keep it demo-able end-to-end in sandbox.** Everything must work against the PayPal sandbox with sandbox accounts; local dev must work without a public webhook URL (use the sync fallback).

## Product rules

- **Single-user app, no authentication.** Do not build login or signup.
- **Currency is USD** (sandbox).
- **DEMO_MODE=true:** every invoice is sent to `SANDBOX_BUYER_EMAIL` regardless of the extracted email. The
  original extracted email is stored and shown with a "demo: routed to sandbox buyer" note. Subcontractors use
  sandbox emails from `SANDBOX_SUB1_EMAIL` and `SANDBOX_SUB2_EMAIL`.
- **Pasted text is untrusted data.** AI prompts treat it as content to extract from, never as instructions.
  Agent actions always need human approval.
- **Rate-limit every endpoint that calls Claude.** AI calls have a 30-second timeout and a graceful fallback.
- **All date logic uses `clock.now()`**, never `Date.now()` or `new Date()` directly.

## Commands

- `npm run dev` — start dev server
- `npm run lint` — ESLint
- `npm run build` — production build
- `npm run db:migrate` / `npm run db:seed` / `npm run db:reset` — Prisma (SQLite locally)
- `npm run db:migrate:pg -- <name>` — matching Postgres migration for Render. **Every schema change needs both.**
- `npm run smoke:invoice` — create + send a sandbox invoice; `npm run smoke:invoice -- <id>` shows its status
- `npm run typecheck` — `tsc --noEmit`
- `npm test` — Vitest (tests/); PayPal and Anthropic are always mocked, never called
- CI (`.github/workflows/ci.yml`) runs lint + typecheck + tests on every push

## Data notes

- Demo data = REAL PayPal sandbox invoices (`src/lib/demo/seed.ts`), all due in the future; overdue states come from
  the demo clock (`src/lib/clock.ts`, offset in `AppSetting`). `isDemo = true` only marks seeded rows for a badge.
- One `Payout` row per PayPal payout item, `sender_item_id = Payout.id`; a split can have several payouts when the
  client pays in installments. `PayoutSplit.payout*` fields are a summary refreshed by `refreshSplitSummary`.
- `AgentAction.pendingKey` (`collect:<invoiceId>` / `payout:<invoiceId>`) is set while PROPOSED/APPROVED and cleared on
  decision; its unique index prevents duplicate proposals across concurrent agent runs.
- Rules (`agent/policy.ts`) decide stage, action, tone and the 0–100 risk score. Claude only writes wording and
  one-line reasons; every AI call has a template/rule fallback.
- ESLint forbids `new Date()` / `Date.now()` in `src/` (use `clock.now()`); real-world timers carry an explicit disable.
- `/api/cron/agent` (Bearer `CRON_SECRET`) syncs with PayPal, then runs the agent.
