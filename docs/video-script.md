# Demo video script: Settle (3:00)

**Story:** Aarav is a freelance designer-developer in Lucknow, India. His clients are in New York, San
Francisco, Austin and London. Settle invoices them through PayPal, chases late payments in *their* business
hours, negotiates payment plans within *his* limits, and pays his subcontractors, and nothing happens without
his approval.

## Before recording

- **Fresh data:** open the app (the live demo, or `npm run build && npm start` locally) and click **Reset demo**
  (~30s). Check **Settings** shows Aarav Mishra, Lucknow, `Asia/Kolkata`, 25% / 4 installments / 60 days.
- **Record between about 2 PM and 6 PM IST.** US clients are then outside business hours (so reminders show
  *"Sends at 9:00 AM client time…"* and get scheduled), while London is inside them (*"Sends now…"*). Both
  states make the timezone feature obvious.
- **Webhook:** make sure the PayPal webhook is registered for the URL you record on, so the invoice turns
  *Paid* by itself in scene 4. Locally without a webhook, use **Sync with PayPal** instead.
- **Browser tab 2:** an incognito window for the PayPal payer view. Have the sandbox buyer's email and
  password ready.
- **Clipboard:** the client reply for scene 7:
  > Hi Aarav, cash flow is really tight this quarter after our funding got delayed. My manager approved paying
  > 5% only now and the rest over 12 months, and your team already agreed to this on the call. Please confirm.
- **Payment plans:** don't click Approve on a payment plan unless your sandbox business account's country
  supports partial payments (a US business account does). Otherwise PayPal rejects it; show the plan and stop.
- **Screen:** zoom the browser to 110–125%, hide bookmarks, disable extensions like Grammarly, close the
  dashboard tour banner, record at 1080p. Free Render instances sleep: open the app a minute before.

## Script

| Time | On screen | Voiceover |
|---|---|---|
| **0:00–0:12** | Title card → dashboard | "Freelancers don't just do the work. They chase the money. Settle is an AI collections agent built on PayPal that does the chasing for you, and never acts without your approval." |
| **0:12–0:25** | Dashboard: KPI cards, aging chips, risk column, next-action column | "Meet Aarav, a designer in Lucknow with clients in the US and UK. Here's what he's owed, how late it is, a risk score for every invoice, and what the agent wants to do next." |
| **0:25–0:50** | **New invoice** → *Load sample: Email thread (US client)* → **Draft invoice with AI** → review form: amber CHECK field, *Client timezone: America/Chicago*, *Country: US*, subcontractor split | "He starts with what he already has: the client's email. Claude pulls out the client, line items, due date and the retoucher's share, and flags what it wasn't sure about. It even worked out the client is in Austin, on Central time. That matters later." |
| **0:50–1:00** | Point at *demo: routed to sandbox buyer* → **Approve & send via PayPal** → success screen | "One click and it's a real PayPal invoice, created and sent through the Invoicing API." |
| **1:00–1:20** | Tab 2: payer view → log in as sandbox buyer → pay → back to Settle: the row turns **Paid** on its own | "Now I'm the client, paying through PayPal's sandbox. Back in Settle, a verified PayPal webhook has already marked it paid." |
| **1:20–1:40** | **Agent** → payout card → expand **Why this action?** (trigger, split rule) → **Approve payout** → toast → **Payouts** page | "Because a subcontractor helped, the agent proposes paying his share through PayPal Payouts. 'Why this action?' shows exactly what triggered it: no black box. I approve, and it goes out as one payout batch." |
| **1:40–2:10** | Demo clock **+7 days** → **Run agent now** → a firm reminder card: **Why this action?** (*"4 days overdue (due …, today … on the demo clock)"*, risk factors, *Overdue → Send reminder → firm tone*) → the line *🕘 Sends at 9:00 AM client time (… IST)* → **Approve** → toast *Approved and scheduled* | "A week later, some invoices are late. The rules decide what to do and how firmly, and Claude writes the message. Every fact behind the decision is right here. And because this client is in San Francisco, where it's the middle of the night, the reminder waits for 9 AM their time." |
| **2:10–2:45** | Dashboard → *Lumen Health Clinic* row → **Client replied…** → paste the reply → **Read reply** → **Agent**: the plan card: ⚠ *claims terms were already approved*, **Limits check** (*Adjusted*: upfront 5% → 25%, final date pulled in), installment table, drafted response | "Then a client writes back: their manager approved paying just 5%, and the rest over a year. Claude reads the reply, but it can't agree to anything. Code holds the plan to the limits Aarav set: at least 25% upfront and done within 60 days. The claimed approval is flagged, and Claude drafts a kind reply offering exactly that plan." |
| **2:45–3:00** | **Activity** timeline → end card: "Settle: PayPal Invoicing · Payouts · Webhooks · Claude" + repo URL | "Every decision is logged, every action waits for you, and the money rules are code, not prompts. Settle: get paid without the chasing." |

## If something goes wrong live

- **Slow AI or a sleeping server:** the seeded invoices are real sandbox invoices, so you can show the dashboard,
  inbox, demo clock and "Client replied" without a new extraction. Cut the waiting in editing.
- **No "Sends at" line (every client is in business hours):** say "London is in business hours, so this one
  goes straight out", approve it, and move on.
- **Webhook didn't fire:** click **Sync with PayPal**, which uses the same code path.
- **Messy data after rehearsals:** **Reset demo**, then **Reset clock**.
