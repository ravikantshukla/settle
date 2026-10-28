/**
 * One-shot "call this tool" helper: a single strict tool, validated with zod.
 *
 * Current models reject forced tool_choice, so we use tool_choice "auto" + a system instruction
 * to always call the tool; `strict: true` guarantees schema-valid arguments, zod checks semantics.
 * Every call is capped at 30 seconds; all failures surface as AiToolError so callers can fall back.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { aiModel, anthropic, fallbackParams } from "./client";

export const AI_TIMEOUT_MS = 30_000;

export type AiFailure = "timeout" | "rate_limited" | "unavailable" | "refused" | "invalid" | "not_configured";

export class AiToolError extends Error {
  constructor(
    message: string,
    public readonly detail?: unknown,
    public readonly kind: AiFailure = "invalid",
  ) {
    super(message);
    this.name = "AiToolError";
  }
}

export interface StrictToolCall<S extends z.ZodType> {
  tool: Anthropic.Beta.BetaTool & { name: string };
  schema: S;
  system: string;
  user: string;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
}

function toAiError(e: unknown): AiToolError {
  if (e instanceof AiToolError) return e;
  if (e instanceof Anthropic.APIConnectionTimeoutError || e instanceof Anthropic.APIUserAbortError || (e instanceof Error && e.name === "TimeoutError")) {
    return new AiToolError("The AI took longer than 30 seconds to respond.", undefined, "timeout");
  }
  if (e instanceof Anthropic.RateLimitError) return new AiToolError("The AI service is busy right now.", undefined, "rate_limited");
  if (e instanceof Anthropic.AuthenticationError) return new AiToolError("The AI isn't configured (check ANTHROPIC_API_KEY).", undefined, "not_configured");
  if (e instanceof Anthropic.APIError) return new AiToolError(`The AI service returned an error (${e.status ?? "network"}).`, e.message, "unavailable");
  if (e instanceof Error && /ANTHROPIC_MODEL|ANTHROPIC_API_KEY|api key/i.test(e.message)) {
    return new AiToolError("The AI isn't configured (set ANTHROPIC_API_KEY and ANTHROPIC_MODEL).", e.message, "not_configured");
  }
  return new AiToolError("The AI is unavailable right now.", e instanceof Error ? e.message : e, "unavailable");
}

export async function callStrictTool<S extends z.ZodType>(call: StrictToolCall<S>): Promise<{ data: z.infer<S>; model: string }> {
  let response: Anthropic.Beta.BetaMessage;
  try {
    const model = aiModel();
    response = await anthropic().beta.messages.create(
      {
        model,
        max_tokens: call.maxTokens ?? 16000,
        output_config: { effort: call.effort ?? "medium" },
        system: `${call.system}\nAlways respond by calling the ${call.tool.name} tool exactly once; do not reply with plain text.`,
        tools: [{ ...call.tool, strict: true }],
        tool_choice: { type: "auto", disable_parallel_tool_use: true },
        messages: [{ role: "user", content: call.user }],
        ...fallbackParams(model),
      },
      // Hard 30s cap for the whole call, retries included.
      { timeout: AI_TIMEOUT_MS, maxRetries: 1, signal: AbortSignal.timeout(AI_TIMEOUT_MS) },
    );
  } catch (e) {
    throw toAiError(e);
  }

  if (response.stop_reason === "refusal") {
    throw new AiToolError("The AI declined to process this request.", response.stop_details, "refused");
  }
  if (response.stop_reason === "max_tokens") {
    throw new AiToolError("The AI response was cut off.", undefined, "invalid");
  }
  const block = response.content.find(
    (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === call.tool.name,
  );
  if (!block) throw new AiToolError("The AI did not return a result. Try again.", undefined, "invalid");

  const parsed = call.schema.safeParse(block.input);
  if (!parsed.success) throw new AiToolError("The AI returned an invalid result.", parsed.error.issues, "invalid");
  return { data: parsed.data, model: response.model };
}

export const nullableString = { type: ["string", "null"] } as const;
export const nullableNumber = { type: ["number", "null"] } as const;
