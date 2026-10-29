// Calls a CRON_SECRET-protected endpoint on the deployed app. Used by the GitHub Actions schedules:
//   node scripts/cron-agent.mjs                  -> /api/cron/agent  (agent-cron.yml, hourly)
//   node scripts/cron-agent.mjs /api/demo/reset  -> demo reset       (demo-reset.yml, every 6 hours)
// Env: SETTLE_URL (https://… or a bare host), CRON_SECRET.
// Retries a few times because a sleeping free Render service can take ~1 minute to wake up.
const raw = process.env.SETTLE_URL;
const secret = process.env.CRON_SECRET;
if (!raw || !secret) {
  console.error("SETTLE_URL and CRON_SECRET are required");
  process.exit(1);
}
const path = process.argv[2] ?? "/api/cron/agent";
const base = (raw.startsWith("http") ? raw : `https://${raw}`).replace(/\/+$/, "");

for (let attempt = 1; attempt <= 4; attempt++) {
  try {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(280_000),
    });
    const text = await res.text();
    console.log(`attempt ${attempt}: HTTP ${res.status}`, text.slice(0, 2000));
    if (res.ok) process.exit(0);
    // Configuration problems (bad secret, DEMO_MODE off, missing env) won't fix themselves; don't retry.
    if ((res.status >= 400 && res.status < 500) || (res.status === 503 && text.includes("CRON_SECRET"))) process.exit(1);
  } catch (e) {
    console.log(`attempt ${attempt}: ${e instanceof Error ? e.message : e}`);
  }
  await new Promise((r) => setTimeout(r, 20_000 * attempt));
}
process.exit(1);
