import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Dummy credentials: PayPal and Anthropic are mocked, and nothing may reach a real service.
    env: {
      PAYPAL_CLIENT_ID: "test-client",
      PAYPAL_CLIENT_SECRET: "test-secret",
      PAYPAL_API_BASE: "https://paypal.test",
      PAYPAL_WEBHOOK_ID: "WH-TEST",
      ANTHROPIC_API_KEY: "test-key",
      ANTHROPIC_MODEL: "claude-opus-5-5",
    },
  },
});
