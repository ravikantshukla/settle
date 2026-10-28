/** Tiny client-side fetch helper: JSON in/out, throws Error(message) on non-2xx. */
export async function sendJson<T = unknown>(method: "POST" | "PUT" | "PATCH", url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) {
    const err = new Error(data.error ?? data.message ?? `Request failed (${res.status})`);
    (err as Error & { data?: unknown }).data = data;
    throw err;
  }
  return data as T;
}

export const postJson = <T = unknown>(url: string, body?: unknown) => sendJson<T>("POST", url, body);
