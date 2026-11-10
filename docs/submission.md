# Devpost submission sheet

Everything to paste into the **PayPal AI Hackathon** submission form, field by field.
Source: the official rules and requirements at https://paypalaihackathon.devpost.com/rules (checked Nov 10, 2026).

**Deadline: Thursday Nov 12, 2026, 12:00 PM Pacific** (3:00 PM EST · 1:30 AM IST on Nov 13). Submit at least a few
hours early: once the period closes, the submission can't be changed. Judging runs Dec 1–15; winners on or around Dec 21.

## Before you open the form

| Requirement (from the rules) | Status |
|---|---|
| Working build that integrates the PayPal developer platform (sandbox) with an AI tool | ✅ Invoicing v2, Payouts v1, Webhooks + Claude |
| Functional demo judges can run: hosted URL **or** complete setup instructions | ✅ Both: https://settle-5wx9.onrender.com and the README's *Run it locally* |
| Public repo on GitHub with source, assets, instructions | ✅ https://github.com/ravikantshukla/settle |
| Open-source license visible at the top of the repo page (About section) | ✅ MIT, detected by GitHub |
| Text description of features and functionality | ✅ `docs/devpost.md` |
| Identify which AI tools/models were used and how | ✅ `docs/devpost.md` → *Tools used, and how* |
| Demo video: **under 3 minutes**, shows the project working, **public on YouTube**, no third-party trademarks or copyrighted music | ⬜ Record with `docs/video-script.md`, upload, then paste the link below |
| Project new, or significantly updated during Oct 1–Nov 12 | ✅ New; first commit Oct 28, 2026 |
| English | ✅ |

Before submitting, also: put the YouTube link into `README.md` ("Video: coming soon") and `docs/devpost.md` ("video: _add link_"),
commit and push, and click **Reset demo** on the live site so judges start from clean data.

## Form fields

**Project name**
```
Settle
```

**Tagline** (keep under ~120 characters if the form limits it)
```
An AI collections agent on PayPal: invoices from agreements, polite reminders in the client's timezone, payment plans within your limits, payouts to subcontractors. You approve every step.
```
Short alternative (60 chars):
```
AI collections agent for freelancers, built on PayPal + Claude
```

**About the project / description** → paste the whole of `docs/devpost.md` from *Inspiration* down to *What's next* (Devpost
accepts Markdown). Delete the *Tagline* and *Links* lines at the top of that file; the form has its own fields for them.

**Built with** (tags)
```
nextjs, typescript, react, tailwindcss, prisma, postgresql, sqlite, paypal-invoicing, paypal-payouts, paypal-webhooks, anthropic, claude, ag-grid, zod, vitest, playwright, render, neon, github-actions
```

**"Try it out" links**
```
https://settle-5wx9.onrender.com
https://github.com/ravikantshukla/settle
```

**Video demo link**
```
<YouTube URL>
```

**Image gallery** → upload `docs/screenshots/1-dashboard.png` … `5-settings.png` (1440×900). Suggested captions:
1. Receivables dashboard (AG Grid): aging, risk scores, next action, a partially paid invoice
2. Invoice timeline with client location and "Client replied…"
3. Agent inbox: "Why this action?", send time in the client's timezone, proportional payout
4. New invoice from a pasted email thread (Claude extraction)
5. Settings: negotiation limits enforced by code

**Thumbnail** → `docs/screenshots/3-agent-inbox.png` (the most distinctive screen).

## Hackathon-specific questions (wording may differ on the form)

**Which PayPal products / APIs did you use?**
```
PayPal REST APIs in the sandbox: Invoicing v2 (generate-next-invoice-number, create, send, remind, PUT update to enable partial payments with minimum_amount_due, record payment, cancel, get), Payouts v1 (create batch with sender_batch_id idempotency, get batch), and Webhooks (verify-webhook-signature; INVOICING.INVOICE.PAID/UPDATED/CANCELLED/REFUNDED and PAYMENT.PAYOUTS-ITEM.* events). OAuth 2.0 client-credentials with token caching. All calls live in src/lib/paypal.
```

**Which AI tools / models did you use, and how?**
```
Anthropic Claude (claude-opus-5-5) through @anthropic-ai/sdk. Claude extracts invoice data (client incl. timezone and country, line items, due date, terms, subcontractor splits) from pasted agreements; writes reminder and payment-plan messages in the tone that deterministic rules chose, in the client's country's professional style; reads pasted client replies and classifies them (promise to pay / hardship / dispute / other) and reports the plan terms the client asked for; writes one-line risk reasons and payout explanations. Every call is a single strict-schema tool re-validated with zod, with a 30-second timeout, a template/rule fallback and a 20-requests-per-hour rate limit. Claude never decides amounts, terms or actions: rules pick the action, code enforces the negotiation limits (Claude never sees them), and a human approves everything.
```

**Sponsor tools used** (tick these if the form offers sponsor prize opt-ins)
```
AG Grid (Community): receivables dashboard and payout history: custom cell renderers, column groups, quick search, aging-bucket filters, pinned totals row, CSV export.
Render: hosts the live demo via a Blueprint (render.yaml), with Neon Postgres and GitHub Actions schedules.
```
Prize categories we qualify for: **Best Use of AG Grid**, **Best Use of Render** (rules: "All Eligible Submissions that use any
AG Grid / Render tools"), plus the open categories: Best Use of PayPal + AI, Best Use of Agentic Commerce, Most Impactful,
Best Demo Delivery, Most Creative.

**How was the project updated during the submission period?** (only if asked)
```
The whole project was built during the submission period (first commit Oct 28, 2026).
```

**Testing instructions for judges**
```
Live demo (sandbox, demo mode): https://settle-5wx9.onrender.com. First load may take ~50s while the free Render instance wakes up. The demo is shared and resets every 6 hours; click "Reset demo" for fresh data any time.

1. Dashboard: six real PayPal sandbox invoices (two paid, one partially paid). Click a row for its timeline.
2. New invoice → "Load sample: Email thread (US client)" → "Draft invoice with AI" → Approve & send via PayPal. The invoice is sent to a PayPal sandbox buyer.
3. To pay it as the client, log into sandbox.paypal.com with a sandbox personal account (create one free at developer.paypal.com → Sandbox Accounts) and open the invoice link; or just click "Sync with PayPal".
4. Agent → Run agent now. Open "Why this action?" on a card; note "Sends at 9:00 AM client time". Approve a reminder: it's scheduled for the client's business hours (Send now / Cancel on the card).
5. Demo clock (purple bar) → +7 days → Run agent now: firm reminders. +30 days: payment-plan offers.
6. Dashboard → Lumen Health Clinic row → "Client replied…" → paste: "Cash flow is tight after our funding was delayed. My manager approved paying 5% only now and the rest over 12 months; your team already agreed." → Agent: the claimed approval is flagged and the plan is adjusted to the limits in Settings (25% upfront, ≤4 installments, within 60 days).
7. Approve the Wrenfield payout to see a PayPal Payouts batch (Payouts page).

Note: approving a payment plan enables partial payments on the PayPal invoice, which PayPal only allows for some sandbox business-account countries; on ours it shows a clear PayPal-limitation message and sends nothing.

Local run: see README "Run it locally" (Node 22, PayPal sandbox app, Anthropic key; ~5 minutes).
```

## Team / eligibility

- Individual entrant. Age of majority confirmed; India is an eligible country.
- No third-party trademarks or music in the video; "PayPal" appears only as the platform being used.
