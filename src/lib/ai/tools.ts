/**
 * One-shot "call this tool" helper: a single strict tool, validated with zod.
 *
 * Current models reject forced tool_choice, so we use tool_choice "auto" + a system instruction
 * to always call the tool; `strict: true` guarantees schema-valid arguments, zod checks semantics.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { aiModel, anthropic, fallbackParams } from "./client";

export class AiToolError extends Error {
  constructor(message: string, public readonly detail?: unknown) {
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

export async function callStrictTool<S extends z.ZodType>(
  call: StrictToolCall<S>,
): Promise<{ data: z.infer<S>; model: string }> {
  const model = aiModel();
  const response = await anthropic().beta.messages.create({
    model,
    max_tokens: call.maxTokens ?? 16000,
    output_config: { effort: call.effort ?? "medium" },
    system: `${call.system}\nAlways respond by calling the ${call.tool.name} tool exactly once; do not reply with plain text.`,
    tools: [{ ...call.tool, strict: true }],
    tool_choice: { type: "auto", disable_parallel_tool_use: true },
    messages: [{ role: "user", content: call.user }],
    ...fallbackParams(model),
  });

  if (response.stop_reason === "refusal") {
    throw new AiToolError("The AI declined to process this request.", response.stop_details);
  }
  if (response.stop_reason === "max_tokens") {
    throw new AiToolError("The AI response was cut off.");
  }
  const block = response.content.find(
    (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === call.tool.name,
  );
  if (!block) throw new AiToolError("The AI did not return a result. Try again.");

  const parsed = call.schema.safeParse(block.input);
  if (!parsed.success) throw new AiToolError("The AI returned an invalid result.", parsed.error.issues);
  return { data: parsed.data, model: response.model };
}

export const nullableString = { type: ["string", "null"] } as const;
export const nullableNumber = { type: ["number", "null"] } as const;
