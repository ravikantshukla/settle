# Deploying Settle to Render

`render.yaml` defines everything: a Postgres database, the web service, and an hourly cron job
that runs the agent.

## How the database works

| | Local dev | Render |
|---|---|---|
| Provider | SQLite (`prisma/schema.prisma`) | Postgres (`prisma/postgres/schema.prisma`, generated) |
| Migrations | `prisma/migrations` | `prisma/postgres/migrations` |
| Applied by | `npm run db:migrate` | `prisma migrate deploy` in `npm run start:render`, on every deploy |

**Changing the schema:** edit `prisma/schema.prisma`, then run both:

```bash
npm run db:migrate                      # SQLite migration for local dev
npm run db:migrate:pg -- add_something  # matching Postgres migration + refreshed snapshot
```

Commit both migration folders. `npm run build:render` fails if you forget the Postgres one.

## Environment variables

Set in the Render dashboard (`settle` service → Environment). The Blueprint creates the keys;
you fill in those marked **you**.

| Variable | Value | Set by |
|---|---|---|
| `DATABASE_URL` | Render Postgres internal connection string | Blueprint (auto) |
| `PAYPAL_API_BASE` | `https://api-m.sandbox.paypal.com` | Blueprint |
| `PAYPAL_CLIENT_ID` | Sandbox app client ID | **you** |
| `PAYPAL_CLIENT_SECRET` | Sandbox app secret | **you** |
| `PAYPAL_WEBHOOK_ID` | ID of the webhook you register in step 5 | **you** (after deploy) |
| `ANTHROPIC_API_KEY` | Anthropic API key | **you** |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | Blueprint (change if you like) |
| `APP_BASE_URL` | Your public URL, e.g. `https://settle.onrender.com` | **you** |
| `CRON_SECRET` | Random secret, shared with the cron job | Blueprint (generated) |
| `DEMO_MODE` | `true` to show "Reset demo" / "Load demo data" | Blueprint (`true`) |
| `NODE_VERSION` | `22` | Blueprint |

The cron job (`settle-agent-hourly`) gets `SETTLE_URL` and `CRON_SECRET` from the web service
automatically.

`SANDBOX_BUYER_EMAIL` is only used by the local smoke script and isn't needed on Render.

## Step by step

1. **Push the repo to GitHub** (public, for judging).
2. **Create the Blueprint.** In Render: **New → Blueprint**, pick the repo, then **Apply**. Render
   creates `settle-db`, `settle` and `settle-agent-hourly` and prompts for the `sync: false` variables.
   Enter the PayPal client ID/secret and Anthropic key. Leave `PAYPAL_WEBHOOK_ID` empty for now and
   put a placeholder in `APP_BASE_URL`.
   - The cron job needs a paid instance type (Render has no free cron jobs). To stay on the free
     plan, delete `settle-agent-hourly` and use **Sync with PayPal** / **Run agent now** in the UI.
     Alternatively, call the endpoint from any external scheduler:
     `curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/agent`
3. **Wait for the first deploy.** The build generates the Postgres client; the start command runs
   `prisma migrate deploy` and then `next start`. Render waits for `/api/health` to return 200.
4. **Check it.** Open `https://<your-service>.onrender.com/api/health`. You should see
   `"db":"ok"`, `"paypal":"sandbox"` and `"ai":"configured"`. Set `APP_BASE_URL` to that origin.
   Open the app and click **Load demo data** for the sample invoices.
5. **Register the production webhook in PayPal:**
   1. Go to <https://developer.paypal.com/dashboard/applications/sandbox> and open the **same app**
      whose client ID you set on Render.
   2. Scroll to **Sandbox Webhooks → Add Webhook**.
   3. Webhook URL: `https://<your-service>.onrender.com/api/webhooks/paypal`
   4. Event types:
      - `Invoicing invoice paid`, `Invoicing invoice updated`, `Invoicing invoice cancelled`,
        `Invoicing invoice refunded`
      - all `Payment payouts-item …` events (succeeded, failed, blocked, canceled, denied, held,
        refunded, returned, unclaimed)
   5. Save, then copy the **Webhook ID** shown in the list.
   6. In Render, set `PAYPAL_WEBHOOK_ID` to that ID and save. Render redeploys automatically.
6. **Test end to end.** Create an invoice to your sandbox **personal** account's email, pay it from
   the PayPal link while logged in as that account, and watch the invoice turn PAID (webhook) within
   seconds. The agent proposes the subcontractor payout in the inbox.
   - In Render's logs, a rejected webhook shows `signature verification failed`. That means
     `PAYPAL_WEBHOOK_ID` doesn't match the app or URL.

## Free-tier notes

- Free web services sleep after ~15 minutes idle; the first request takes ~1 minute. Open the app
  before a live demo.
- Free Postgres databases expire after 30 days.
- PayPal retries webhooks that fail while the service is waking up, and **Sync with PayPal**
  catches anything missed.
