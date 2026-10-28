import { afterEach, describe, expect, it, vi } from "vitest";
import { invalidateAccessToken, paypalFetch, PayPalError } from "@/lib/paypal";

function mockFetch(apiResponse: Response) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/v1/oauth2/token")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }));
      return apiResponse.clone();
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  invalidateAccessToken();
});

describe("paypalFetch", () => {
  it("sends a JSON content type on body-less POSTs (PayPal returns 415 otherwise)", async () => {
    const calls = mockFetch(new Response(JSON.stringify({ invoice_number: "0001" })));
    await paypalFetch("/v2/invoicing/generate-next-invoice-number", { method: "POST" });
    const headers = calls.at(-1)!.init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(calls.at(-1)!.init.body).toBeUndefined();
  });

  it("surfaces PayPal's error name, field details and debug_id", async () => {
    mockFetch(
      new Response(
        JSON.stringify({
          name: "INVALID_REQUEST",
          message: "Request is not well-formed",
          debug_id: "abc123",
          details: [{ field: "/configuration/partial_payment/allow_partial_payment", issue: "UNSUPPORTED", description: "Partial payments are not available in your country." }],
        }),
        { status: 400 },
      ),
    );
    const err = await paypalFetch<never>("/v2/invoicing/invoices", { method: "POST", body: {} }).catch((e: PayPalError) => e);
    expect(err).toBeInstanceOf(PayPalError);
    expect(err.debugId).toBe("abc123");
    expect(err.toDisplayString()).toMatch(/Partial payments are not available in your country.*debug_id abc123/);
  });
});
