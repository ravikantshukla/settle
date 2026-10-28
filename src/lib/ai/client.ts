import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

export function anthropic(): Anthropic {
  client ??= new Anthropic();
  return client;
}

/** Model id from ANTHROPIC_MODEL — never hard-code it. */
export function aiModel(): string {
  const model = process.env.ANTHROPIC_MODEL;
  if (!model) throw new Error("Missing required env var ANTHROPIC_MODEL (see .env.example)");
  return model;
}

// Models that accept the server-side refusal fallback ("default" routing).
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

/**
 * Request params that enable server-side refusal fallback when the configured model supports it,
 * so a safety-classifier false positive is retried on another model instead of failing the request.
 */
export function fallbackParams(model: string): { betas?: string[]; fallbacks?: "default" } {
  return FALLBACK_MODELS.has(model)
    ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }
    : {};
}
