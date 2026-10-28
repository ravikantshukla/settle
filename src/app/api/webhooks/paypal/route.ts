import { NextResponse } from "next/server";
import { handleWebhookEvent } from "@/lib/invoices/handleWebhookEvent";
import { PayPalError, verifyWebhookSignature, type PayPalWebhookEvent } from "@/lib/paypal";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const rawBody = await req.text();

  let event: PayPalWebhookEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!event?.id || !event.event_type) {
    return NextResponse.json({ error: "Not a PayPal webhook event" }, { status: 400 });
  }

  try {
    if (!(await verifyWebhookSignature(req.headers, rawBody))) {
      console.warn(`Rejected PayPal webhook ${event.id}: signature verification failed`);
      return NextResponse.json({ error: "Signature verification failed" }, { status: 401 });
    }
  } catch (e) {
    console.error("Webhook verification error", e instanceof PayPalError ? e.toDisplayString() : e);
    // 5xx makes PayPal retry later.
    return NextResponse.json({ error: "Could not verify signature" }, { status: 503 });
  }

  try {
    const outcome = await handleWebhookEvent(event);
    return NextResponse.json({ ok: true, outcome });
  } catch (e) {
    console.error(`Webhook ${event.id} (${event.event_type}) failed`, e instanceof PayPalError ? e.toDisplayString() : e);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
