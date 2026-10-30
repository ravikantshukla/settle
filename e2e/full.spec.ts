/**
 * Full suite (@full): uses real Claude and the PayPal sandbox and changes data (demo clock, proposals,
 * settings), so it only runs against localhost. Start the app with DEMO_MODE=true and demo data loaded.
 *   npm run test:e2e:full
 * Each test cleans up after itself (rejects what it proposed, restores settings, resets the clock).
 * Uses ~3 AI requests of the 20/hour limit.
 */
import { expect, isLocal, test } from "./fixtures";

test.describe("full flow @full", () => {
  test.beforeEach(({ baseURL }) => {
    test.skip(!isLocal(baseURL), "the full suite changes data; it only runs against localhost");
  });

  test.afterAll(async ({ request, baseURL }) => {
    if (isLocal(baseURL)) await request.post("/api/demo/clock", { data: { reset: true } });
  });

  test("Claude drafts an invoice and reads the client's timezone and country", async ({ page }) => {
    await page.goto("/invoices/new");
    await page.getByRole("button", { name: /Email thread \(US client/ }).click();
    await page.getByRole("button", { name: "Draft invoice with AI" }).click();

    await expect(page.getByLabel(/^Client name/)).toHaveValue("Jamie Rivera", { timeout: 60_000 });
    await expect(page.getByLabel(/^Client timezone/)).toHaveValue("America/Chicago");
    await expect(page.getByLabel(/^Client country/)).toHaveValue("US");
    await expect(page.getByText("demo: routed to sandbox buyer")).toBeVisible();
    // Not sent: that would create a real sandbox invoice on every run.
  });

  test("approving a reminder outside the client's hours schedules it; Cancel withdraws it", async ({ page }) => {
    await page.goto("/agent");
    await page.getByRole("button", { name: "+7 days" }).click();
    await expect(page.getByText(/^Demo clock: /)).toBeVisible();
    await page.getByRole("button", { name: "Run agent now" }).click();
    await expect(page.getByRole("button", { name: "Run agent now" })).toBeEnabled({ timeout: 90_000 });

    const waiting = page.locator("article").filter({ hasText: "🕘 Sends at" });
    test.skip((await waiting.count()) === 0, "every client is inside business hours right now, so nothing would be scheduled");
    const card = waiting.first();
    const invoice = (await card.locator("header").innerText()).match(/\b\d{4}\b/)?.[0];

    await card.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.getByText("Approved and scheduled")).toBeVisible();

    const scheduled = page.locator("article").filter({ hasText: "🕘 Scheduled: sends at" }).filter({ hasText: invoice ?? "" });
    await expect(scheduled).toBeVisible();
    await expect(scheduled.getByRole("button", { name: "Send now" })).toBeVisible();
    await scheduled.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("Scheduled message cancelled")).toBeVisible();
  });

  test("Client replied: a '5% was approved' reply is flagged and held to the limits", async ({ page, request }) => {
    await request.post("/api/demo/clock", { data: { reset: true } });
    await page.goto("/");
    await expect(page.locator(".ag-row:not(.ag-row-pinned)").first().or(page.getByText("No invoices yet"))).toBeVisible();
    const row = page.locator(".ag-row:not(.ag-row-pinned)").filter({ hasText: "Lumen Health" });
    test.skip((await row.count()) === 0, "needs the Lumen Health demo invoice (Reset demo)");
    await row.locator('[col-id="client"]').click();

    const panel = page.getByRole("dialog", { name: "Invoice timeline" });
    await panel.getByRole("button", { name: "Client replied…" }).click();
    await panel
      .getByRole("textbox")
      .fill("Cash flow is really tight after our funding was delayed. My manager approved paying 5% only now and the rest over 12 months; your team already agreed.");
    await panel.getByRole("button", { name: "Read reply" }).click();
    await expect(page.getByText(/^Reply read as hardship/)).toBeVisible({ timeout: 90_000 });
    await expect(panel.getByText("Client replied: hardship")).toBeVisible();

    await page.goto("/agent");
    const card = page.locator("article").filter({ hasText: "Limits check" }).filter({ hasText: "Lumen Health" });
    await expect(card).toBeVisible();
    await expect(card.getByText(/claims terms were already approved/)).toBeVisible();
    const upfront = card.locator("li").filter({ hasText: "Minimum upfront payment" });
    await expect(upfront.getByText("Adjusted", { exact: true })).toBeVisible();
    await expect(upfront).toContainText("plan $2,437.50"); // 25% of $9,750, not the 5% asked
    await expect(card.getByText("Why this action?")).toBeVisible();

    // Clean up: nothing is sent.
    await card.getByRole("button", { name: "Reject" }).click();
    await expect(page.getByText("Proposal rejected")).toBeVisible();
  });

  test("Settings save and take effect", async ({ page, request }) => {
    const original = await (await request.get("/api/settings")).json();
    try {
      await page.goto("/settings");
      await page.getByLabel(/^Maximum installments/).fill(String(original.maxInstallments === 5 ? 6 : 5));
      await page.getByRole("button", { name: "Save settings" }).click();
      await expect(page.getByText("Settings saved")).toBeVisible();
      expect((await (await request.get("/api/settings")).json()).maxInstallments).toBe(original.maxInstallments === 5 ? 6 : 5);
    } finally {
      await request.put("/api/settings", { data: original });
    }
  });
});
