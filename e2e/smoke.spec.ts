/**
 * Smoke suite: read-only. No Claude or PayPal calls and no data changes, so it's safe to run against
 * the shared Render demo:  E2E_BASE_URL=https://settle-5wx9.onrender.com npm run test:e2e
 * Checks that adapt to the data (inbox cards, side panel) skip cleanly when there's nothing to show.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

test("health endpoint reports a working deployment", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBe(true);
  expect(await res.json()).toMatchObject({ ok: true, db: "ok", paypal: "sandbox" });
});

for (const [path, heading] of [
  ["/", "Receivables"],
  ["/invoices/new", /invoice/i],
  ["/agent", "Agent"],
  ["/payouts", /payouts/i],
  ["/subcontractors", /subcontractors/i],
  ["/settings", "Settings"],
] as const) {
  test(`${path} loads without errors`, async ({ page }) => {
    const res = await page.goto(path);
    expect(res?.status()).toBeLessThan(400);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.getByRole("navigation").getByRole("link", { name: "Settings" })).toBeVisible();
  });
}

/** Waits for AG Grid to render (it's client-side), then returns how many invoice rows it shows. */
async function gridRowCount(page: Page): Promise<number> {
  const rows = page.locator(".ag-row:not(.ag-row-pinned)");
  await expect(rows.first().or(page.getByText("No invoices yet"))).toBeVisible();
  return rows.count();
}

test.describe("dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("shows the KPI cards", async ({ page }) => {
    for (const label of ["Outstanding", "Overdue", "Collected this month", "Avg. days to pay", "Pending approvals"]) {
      await expect(page.locator("p").getByText(label, { exact: true })).toBeVisible(); // not the grid header
    }
  });

  test("bucket chips and search filter the grid", async ({ page }) => {
    const rows = page.locator(".ag-row:not(.ag-row-pinned)");
    test.skip((await gridRowCount(page)) === 0, "no invoices yet (load demo data first)");
    const all = await rows.count();

    await page.getByRole("group", { name: "Filter by aging bucket" }).getByRole("button", { name: /^Paid/ }).click();
    await expect(page.getByRole("button", { name: /^Paid/ })).toHaveAttribute("aria-pressed", "true");
    expect(await rows.count()).toBeLessThanOrEqual(all);
    await page.getByRole("button", { name: /^All/ }).click();

    const firstClient = (await rows.first().locator('[col-id="client"]').innerText()).trim();
    await page.getByLabel("Search invoices").fill(firstClient.slice(0, 6));
    await expect(rows.first()).toContainText(firstClient);
    await page.getByLabel("Search invoices").fill("zzz-no-such-client");
    await expect(rows).toHaveCount(0);
  });

  test("exports a CSV", async ({ page }) => {
    test.skip((await gridRowCount(page)) === 0, "no invoices yet");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV" }).click();
    expect((await download).suggestedFilename()).toMatch(/^settle-receivables-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  test("a row opens the side panel with the timeline and client location", async ({ page }) => {
    test.skip((await gridRowCount(page)) === 0, "no invoices yet");
    const row = page.locator(".ag-row:not(.ag-row-pinned)").first();
    await row.locator('[col-id="client"]').click();
    const panel = page.getByRole("dialog", { name: "Invoice timeline" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Invoice created")).toBeVisible();
    await expect(panel.getByText("Client location")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
  });
});

test.describe("agent inbox", () => {
  test("client-facing proposals say when they'll be sent and why", async ({ page }) => {
    await page.goto("/agent");
    const cards = page.locator("article").filter({ hasText: /Reminder|Payment plan/ });
    test.skip((await cards.count()) === 0, "no reminder or payment-plan proposals right now");
    for (const card of await cards.all()) {
      await expect(card.getByText(/^🕘 (Sends|Scheduled)/)).toBeVisible();
      const why = card.getByText("Why this action?");
      if (await why.count()) {
        await expect(card.getByText(/Requires your approval/)).toBeVisible();
      }
    }
  });
});

test("Settings rejects an invalid timezone without saving", async ({ page, request }) => {
  const before = await (await request.get("/api/settings")).json();
  await page.goto("/settings");
  await page.getByLabel(/^Your timezone/).fill("Mars/Olympus");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Pick a valid timezone, e.g. Asia/Kolkata")).toBeVisible();
  expect(await (await request.get("/api/settings")).json()).toEqual(before);
});

test("New invoice: a sample fills the editor (no AI call)", async ({ page }) => {
  await page.goto("/invoices/new");
  const editor = page.getByPlaceholder("Paste the agreement, SOW, or email thread here…");
  await expect(page.getByRole("button", { name: "Draft invoice with AI" })).toBeDisabled();
  await page.getByRole("button", { name: /Email thread \(US client/ }).click();
  await expect(editor).toHaveValue(/Lucknow/);
  await expect(page.getByRole("button", { name: "Draft invoice with AI" })).toBeEnabled();
});
