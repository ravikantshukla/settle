# Deploying Settle

| Piece | Where | Why |
|---|---|---|
| Web app | **Render** free web service (`render.yaml`) | Next.js server; migrations run on every deploy |
| Database | **Neon** free Postgres | Doesn't expire (Render's free Postgres is deleted after 30 days; judging runs to Dec 15) |
| Hourly agent | **GitHub Actions** schedule (`.github/workflows/agent-cron.yml`) | Free; Render cron jobs aren't |
| Demo reset every 6h | **GitHub Actions** schedule (`.github/workflows/demo-reset.yml`) | The hosted demo is shared by judges |
| Mode | `DEMO_MODE=true` | Invoices go to the sandbox buyer, demo clock and Reset demo enabled |

## How the database works

| | Local dev | Production |
|---|---|---|
| Provider | SQLite (`prisma/schema.prisma`) | Postgres (`prisma/postgres/schema.prisma`, generated) |
| Migrations | `prisma/migrations` | `prisma/postgres/migrations` |
| Applied by | `npm run setup` / `npm run db:migrate` | `prisma migrate deploy` in `npm run start:render`, on every deploy |

When you change the schema, run **both** `npm run db:migrate` and `npm run db:migrate:pg -- <name>` and
commit both migration folders. The Render build fails if the Postgres snapshot is stale.

## Environment variables

### Render (service `settle` → Environment)

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon **direct** connection string (not the `-pooler` one), ending in `?sslmode=require` |
| `PAYPAL_CLIENT_ID` | Sandbox app client ID |
| `PAYPAL_CLIENT_SECRET` | Sandbox app secret |
| `PAYPAL_WEBHOOK_ID` | ID of the webhook you register in step 6 |
| `PAYPAL_API_BASE` | `https://api-m.sandbox.paypal.com` (preset by the Blueprint) |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` (preset) |
| `APP_BASE_URL` | `https://<your-service>.onrender.com` |
| `CRON_SECRET` | A long random string; **the same value** goes in the GitHub secret |
| `DEMO_MODE` | `true` (preset) |
| `SANDBOX_BUYER_EMAIL` | Sandbox **personal** account that receives and pays every invoice |
| `SANDBOX_SUB1_EMAIL` | Sandbox personal account for subcontractor payouts |
| `SANDBOX_SUB2_EMAIL` | Another sandbox personal account for subcontractor payouts |
| `NODE_VERSION` | `22` (preset) |

Generate `CRON_SECRET` with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

### GitHub (repo → Settings → Secrets and variables → Actions → New repository secret)

| Secret | Value |
|---|---|
| `SETTLE_URL` | `https://<your-service>.onrender.com` |
| `CRON_SECRET` | Same value as on Render |

CI (`ci.yml`) needs no secrets: its tests mock PayPal and Claude.

## Step by step

1. **Sandbox accounts.** At [developer.paypal.com](https://developer.paypal.com/dashboard/accounts) → Testing
   Tools → Sandbox Accounts, make sure you have one **Business** account (your app's owner) and create
   **three Personal** accounts: buyer, sub 1, sub 2. In Apps & Credentials → Sandbox → your app, note the
   client ID/secret and check that **Invoicing** and **Payouts** are enabled under features.
   Create the business account with country **United States** if you can: PayPal only allows partial
   payments (the agent's payment plans) for some countries, and otherwise approving a plan fails.
2. **Neon.** Sign up at [neon.tech](https://neon.tech) → create a project (any region near your Render
   region) → **Connection details** → turn **Connection pooling off** → copy the connection string.
   Migrations need the direct connection; Prisma's migrate lock doesn't work through PgBouncer.
   If your Neon login is managed by Vercel ("New project" is disabled), create the database from
   vercel.com → **Storage → Create Database → Neon** instead and copy `DATABASE_URL_UNPOOLED`.
3. **Push the repo** to a public GitHub repository.
4. **Render.** Go to **New → Blueprint**, select the repo, then **Apply**. Fill in every `sync: false`
   variable from the table above. Put a placeholder in `APP_BASE_URL` and leave `PAYPAL_WEBHOOK_ID`
   empty for now. The first deploy builds, runs `prisma migrate deploy` against Neon, then starts.
5. **Check it.** Open `https://<service>.onrender.com/api/health`. Expect `"db":"ok"`, `"paypal":"sandbox"`,
   `"ai":"configured"` and `"demoMode":true`. Set `APP_BASE_URL` to that origin. Open the app and click
   **Load demo data**. It creates six real sandbox invoices for your buyer, which takes about 30 seconds.
6. **Webhook.** In the PayPal developer dashboard → your sandbox app → **Sandbox Webhooks → Add Webhook**:
   - URL: `https://<service>.onrender.com/api/webhooks/paypal`
   - Events: `Invoicing invoice paid`, `… updated`, `… cancelled`, `… refunded`, and all
     `Payment payouts-item …` events.
   - Save, copy the **Webhook ID** into Render's `PAYPAL_WEBHOOK_ID`. Render redeploys.
7. **GitHub Actions.** Add the `SETTLE_URL` and `CRON_SECRET` secrets. Open the **Actions** tab → *Hourly
   agent run* → **Run workflow** once and check that it logs `HTTP 200`. Do the same for *Demo reset*. It
   calls `/api/demo/reset` with the same `CRON_SECRET`, so it skips the manual 3-per-hour limit.
8. **End-to-end check.** Create an invoice from a sample agreement, pay it as the sandbox buyer, wait for
   the webhook (or click Sync), approve the payout, and confirm the batch on `/payouts`.

## Notes

- Free Render services sleep after ~15 idle minutes, and the first request takes about a minute. The cron
  script retries, and PayPal retries webhooks, so nothing is lost. Open the app a minute before a demo.
- GitHub disables scheduled workflows after 60 days without repository activity. Push a commit or
  re-enable it if judging runs longer.
- The rate limiter is in memory (20 AI requests per hour per IP, 3 manual demo resets per hour). That's fine
  for one Render instance.
- If a scheduled workflow is missing from the **Actions** tab after the repo's first push, GitHub hasn't
  registered it yet: push any change to that workflow file and it appears.
- Settings (your name, timezone and negotiation limits) are stored in the database and survive demo resets.
- After the deploy, check the browser side with the read-only Playwright suite:
  `E2E_BASE_URL=https://<service>.onrender.com npm run test:e2e`.
