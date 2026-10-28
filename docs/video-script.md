# Demo video script: Settle (2:45)

**Before recording**
- Deployed app (or `npm run build && npm start`) with `DEMO_MODE=true`; click **Reset demo** (~30s) so the
  sandbox invoices and the demo clock are fresh.
- Run the agent once beforehand so the inbox has a fresh AI-written proposal.
- Browser tab 2: PayPal sandbox payer view, logged **out**. Have the sandbox personal account email and
  password ready.
- Demo mode sends the invoice to `SANDBOX_BUYER_EMAIL` automatically (the review form says *demo: routed to
  sandbox buyer*). The "Email thread" sample has a subcontractor split, so a payout gets proposed.
- Zoom the browser to 110–125%. Hide bookmarks. Record at 1080p.

| Time | On screen | Voiceover |
|---|---|---|
| **0:00–0:12** | Title card, then the dashboard | "Freelancers don't just do the work. They also chase the money. Settle is an AI collections agent built on PayPal that does the chasing for you, and never acts without your approval." |
| **0:12–0:30** | Dashboard: KPI cards, then hover the grid's aging chips, risk column and next-action column | "This is your receivables at a glance: what's outstanding, what's overdue, and a risk score for each invoice, computed by rules and explained in one line by Claude. The last column is what the agent wants to do next." |
| **0:30–0:58** | **New invoice** → *Load sample: Email thread* → **Draft invoice with AI** → review form (point at an amber CHECK field and the subcontractor split) | "Start with what you already have: the client's email thread. Claude pulls out the client, line items, due date and the subcontractor's cut, and highlights what it wasn't sure about. Here it flags the photographer's share, so I'll confirm it." |
| **0:58–1:10** | Point at the *demo: routed to sandbox buyer* note → **Approve & send via PayPal** → success screen with the PayPal link | "One click and it's a real PayPal invoice, created and sent through the Invoicing API. In demo mode it goes to our sandbox buyer instead of the real client." |
| **1:10–1:32** | Tab 2: payer view → log in as the sandbox personal account → pay | "Now I'm the client. I log into PayPal's sandbox as the buyer and pay the invoice." |
| **1:32–1:50** | Back in Settle → **Sync with PayPal** (or the webhook already updated it) → row turns *Paid* → click the row → timeline side panel | "Settle hears about it through a verified PayPal webhook, or a manual sync. The invoice is paid, and the timeline shows every step." |
| **1:50–2:15** | **Agent** inbox: the payout card with the AI explanation → **Approve payout** → toast "PayPal payout batch … created" → **Payouts** page shows the batch | "Because a subcontractor helped on this job, the agent proposes paying their share through PayPal Payouts and explains the split. I approve, and it goes out as one payout batch." |
| **2:15–2:35** | Demo clock **+7 days** → **Run agent now** → firm reminder card → **Edit & approve**. Then **+30 days** → **Run agent now** → payment-plan card | "Let's skip ahead a week. The rules see these invoices are late, and Claude writes a firm but polite reminder, which I can edit before it goes out through PayPal. A month later, the agent offers an installment plan instead, turning on partial payments on the PayPal invoice." |
| **2:35–2:45** | Activity timeline → end card: "Settle: PayPal Invoicing · Payouts · Webhooks · Claude" + repo URL | "Every decision is logged and every action waits for you. Settle: get paid without the chasing." |

**If something is slow live:** the seeded invoices are real sandbox invoices already in the dashboard, so
you can show the inbox and demo clock without waiting on a new extraction. Wake the Render service a
minute before recording.
