// Render cron job: ask the web service to sync with PayPal and run the agent.
// Env: SETTLE_URL (https://… or a bare host from Render's `fromService.property: host`), CRON_SECRET.
const raw = process.env.SETTLE_URL;
const secret = process.env.CRON_SECRET;
if (!raw || !secret) {
  console.error("SETTLE_URL and CRON_SECRET are required");
  process.exit(1);
}
const base = raw.startsWith("http") ? raw : `https://${raw}`;

const res = await fetch(`${base.replace(/\/+$/, "")}/api/cron/agent`, {
  method: "POST",
  headers: { Authorization: `Bearer ${secret}` },
  signal: AbortSignal.timeout(280_000),
});
const text = await res.text();
console.log(res.status, text.slice(0, 2000));
if (!res.ok) process.exit(1);
