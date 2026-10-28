/**
 * PayPal webhook signature verification.
 * https://developer.paypal.com/docs/api/webhooks/v1/#verify-webhook-signature_post
 */
import { paypalFetch } from "./client";

export interface PayPalWebhookEvent<R = Record<string, unknown>> {
  id: string;
  event_type: string;
  resource_type?: string;
  summary?: string;
  create_time?: string;
  resource: R;
}

const HEADER_MAP = {
  auth_algo: "paypal-auth-algo",
  cert_url: "paypal-cert-url",
  transmission_id: "paypal-transmission-id",
  transmission_sig: "paypal-transmission-sig",
  transmission_time: "paypal-transmission-time",
} as const;

/**
 * Ask PayPal whether this delivery is authentic. `rawBody` must be the exact request body:
 * it is embedded verbatim, because re-serializing the JSON can change bytes and fail verification.
 */
export async function verifyWebhookSignature(headers: Headers, rawBody: string): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) throw new Error("Missing required env var PAYPAL_WEBHOOK_ID (see docs/webhooks.md)");

  const fields: Record<string, string> = { webhook_id: webhookId };
  for (const [field, header] of Object.entries(HEADER_MAP)) {
    const value = headers.get(header);
    if (!value) return false;
    fields[field] = value;
  }

  const prefix = JSON.stringify(fields).slice(0, -1); // drop closing brace
  const res = await paypalFetch<{ verification_status: "SUCCESS" | "FAILURE" }>(
    "/v1/notifications/verify-webhook-signature",
    { method: "POST", rawBody: `${prefix},"webhook_event":${rawBody}}` },
  );
  return res.verification_status === "SUCCESS";
}
