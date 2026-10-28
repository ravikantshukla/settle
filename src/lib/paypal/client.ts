/**
 * Low-level PayPal REST client: OAuth2 token caching + a typed fetch helper.
 * Every PayPal call in the app must go through paypalFetch().
 */

export interface PayPalErrorDetail {
  field?: string;
  value?: string;
  location?: string;
  issue: string;
  description?: string;
}

/** Thrown for any non-2xx PayPal response. Carries PayPal's error name, details and debug_id. */
export class PayPalError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly method: string,
    public readonly path: string,
    public readonly errorName?: string,
    public readonly debugId?: string,
    public readonly details: PayPalErrorDetail[] = [],
    public readonly raw?: unknown,
  ) {
    super(message);
    this.name = "PayPalError";
  }

  /** Compact, human-readable summary suitable for logs and UI error banners. */
  toDisplayString(): string {
    const issues = this.details
      .map((d) => [d.field, d.issue, d.description].filter(Boolean).join(": "))
      .join("; ");
    return [
      `PayPal ${this.status} on ${this.method} ${this.path}`,
      this.errorName,
      this.message,
      issues && `(${issues})`,
      this.debugId && `[debug_id ${this.debugId}]`,
    ]
      .filter(Boolean)
      .join(" ");
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name} (see .env.example)`);
  return value;
}

export function paypalApiBase(): string {
  return (process.env.PAYPAL_API_BASE || "https://api-m.sandbox.paypal.com").replace(/\/+$/, "");
}

// ---------------------------------------------------------------------------
// OAuth2 access token, cached in memory until shortly before expiry
// ---------------------------------------------------------------------------

const EXPIRY_SKEW_MS = 60_000;

let cachedToken: { value: string; expiresAt: number } | null = null;
let inflightToken: Promise<string> | null = null;

export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - EXPIRY_SKEW_MS) {
    return cachedToken.value;
  }
  // Collapse concurrent refreshes into a single request.
  if (!inflightToken) {
    inflightToken = fetchAccessToken().finally(() => {
      inflightToken = null;
    });
  }
  return inflightToken;
}

/** Drop the cached token (e.g. after a 401). */
export function invalidateAccessToken(): void {
  cachedToken = null;
}

async function fetchAccessToken(): Promise<string> {
  const clientId = requireEnv("PAYPAL_CLIENT_ID");
  const secret = requireEnv("PAYPAL_CLIENT_SECRET");
  const path = "/v1/oauth2/token";

  const res = await fetch(`${paypalApiBase()}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });

  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!res.ok || !body.access_token) {
    throw new PayPalError(
      body.error_description || "Failed to obtain PayPal access token",
      res.status,
      "POST",
      path,
      body.error,
      res.headers.get("paypal-debug-id") ?? undefined,
      [],
      body,
    );
  }

  cachedToken = {
    value: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 0) * 1000,
  };
  return body.access_token;
}

// ---------------------------------------------------------------------------
// Typed fetch helper
// ---------------------------------------------------------------------------

export interface PayPalFetchOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** Pre-serialized JSON body, sent byte-for-byte (takes precedence over `body`). */
  rawBody?: string;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  /** Sent as PayPal-Request-Id so retried POSTs are idempotent. */
  requestId?: string;
  /** Ask PayPal to return the full resource instead of a HATEOAS link. */
  preferRepresentation?: boolean;
}

/**
 * Call a PayPal REST endpoint. Resolves to the parsed JSON body
 * (or undefined for 204 No Content). Throws PayPalError on failure.
 */
export async function paypalFetch<T = unknown>(
  path: string,
  opts: PayPalFetchOptions = {},
): Promise<T> {
  const method = opts.method ?? "GET";
  const url = new URL(`${paypalApiBase()}${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }

  const send = async () => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await getAccessToken()}`,
      Accept: "application/json",
      ...opts.headers,
    };
    const body = opts.rawBody ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body));
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (opts.requestId) headers["PayPal-Request-Id"] = opts.requestId;
    if (opts.preferRepresentation) headers["Prefer"] = "return=representation";

    return fetch(url, {
      method,
      headers,
      body,
      cache: "no-store",
    });
  };

  let res = await send();
  if (res.status === 401) {
    // Token may have been revoked or expired early; retry once with a fresh one.
    invalidateAccessToken();
    res = await send();
  }

  const text = await res.text();
  let json: unknown = undefined;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }

  if (!res.ok) {
    const err = (typeof json === "object" && json !== null ? json : {}) as {
      name?: string;
      message?: string;
      debug_id?: string;
      details?: PayPalErrorDetail[];
      error?: string;
      error_description?: string;
    };
    throw new PayPalError(
      err.message || err.error_description || res.statusText || "PayPal request failed",
      res.status,
      method,
      path,
      err.name || err.error,
      err.debug_id || res.headers.get("paypal-debug-id") || undefined,
      err.details ?? [],
      json,
    );
  }

  return json as T;
}
