# PayPal webhooks

Settle receives PayPal events at `POST /api/webhooks/paypal`. Every delivery is verified with
PayPal's `verify-webhook-signature` API against `PAYPAL_WEBHOOK_ID`, stored in `WebhookEvent`
(idempotent on the PayPal event id), and then applied:

| Event | Effect |
|---|---|
| `INVOICING.INVOICE.PAID` / `.UPDATED` / `.CANCELLED` / `.REFUNDED` | Re-fetches the invoice from PayPal and mirrors status + amount paid. If the paid amount grew, calls `agent.onPaymentReceived`. |
| `PAYMENT.PAYOUTS-ITEM.*` | Updates the matching `Payout` row (by `payout_item_id`, or `sender_item_id` = `Payout.id`) and refreshes its split's summary. |

No public URL? Skip webhooks entirely and use **Sync with PayPal** on the dashboard
(`POST /api/sync`). It pulls every open invoice from PayPal through the same code path.

## Register the webhook (sandbox)

1. Open <https://developer.paypal.com/dashboard/applications/sandbox> and select your app.
2. Under **Sandbox Webhooks**, click **Add Webhook**.
3. Webhook URL: `https://<your-public-host>/api/webhooks/paypal`
   (your Render URL, or an ngrok URL for local dev, see below).
4. Select these event types:
   - `Invoicing invoice paid`, `Invoicing invoice updated`, `Invoicing invoice cancelled`, `Invoicing invoice refunded`
   - All `Payment payouts-item ...` events
5. Save, then copy the **Webhook ID** into `.env` as `PAYPAL_WEBHOOK_ID`.

Each webhook ID is tied to one URL. If your ngrok URL changes, edit the webhook's URL in the
dashboard (the ID stays the same), or create a new one and update `PAYPAL_WEBHOOK_ID`.

## Test locally with ngrok

```bash
npm run dev                       # app on http://localhost:3000
ngrok http 3000                   # copy the https://<id>.ngrok-free.app URL
```

1. Register `https://<id>.ngrok-free.app/api/webhooks/paypal` as above and set `PAYPAL_WEBHOOK_ID`.
2. Restart `npm run dev` so it picks up the env var.
3. Create and send an invoice from `/invoices/new`, open the PayPal link, and pay it while logged in
   as your **sandbox personal** account.
4. Within a few seconds the dev server logs the webhook and the invoice shows `PAID` on `/`.
   The ngrok inspector at <http://127.0.0.1:4040> shows each delivery and lets you replay it.
   Replays are safe because events are idempotent.

### Troubleshooting

- **401 "Signature verification failed"**: `PAYPAL_WEBHOOK_ID` doesn't match the webhook that sent
  the event, or the event came from the dashboard **Webhooks simulator**. Simulator events can't
  be verified with `verify-webhook-signature`, so test with real sandbox actions instead.
- **503 "Could not verify signature"**: PayPal credentials or `PAYPAL_WEBHOOK_ID` are missing. Check the
  server log for the PayPal `debug_id`.
- **Event stored but invoice not updated**: the invoice isn't in Settle's DB (e.g. created directly in
  PayPal) or it's demo data. Check `WebhookEvent.error` / `processedAt` with `npx prisma studio`.
