/** Tiny client-side fetch helper: JSON in/out, throws Error(message) on non-2xx. */
export async function postJson<T = unknown>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data as { error?: string; message?: string }).error ?? (data as { message?: string }).message ?? `Request failed (${res.status})`);
    (err as Error & { data?: unknown }).data = data;
    throw err;
  }
  return data as T;
}
