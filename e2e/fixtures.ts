import { expect, test as base } from "@playwright/test";

/**
 * Every test fails if the page logs a console error or throws. React hydration warnings caused by
 * browser extensions can't happen here (Playwright's Chromium has none).
 */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("console", (m) => {
        if (m.type() === "error" && !/favicon/i.test(m.text())) errors.push(m.text());
      });
      page.on("pageerror", (e) => errors.push(e.message));
      await use(errors);
      expect(errors, "console errors on the page").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export const isLocal = (baseURL: string | undefined) => !!baseURL && /\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseURL);
