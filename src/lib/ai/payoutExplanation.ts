/** Claude writes a short, plain-English explanation of a proposed subcontractor payout. */
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { callStrictTool } from "./tools";

const TOOL_NAME = "explain_payout";

const tool: Anthropic.Beta.BetaTool = {
  name: TOOL_NAME,
  description: "Record the explanation of the payout split for the freelancer approving it.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["explanation"],
    properties: {
      explanation: {
        type: "string",
        description: "2-3 sentences: who gets what and why (percent or fixed share; if the invoice is only partly paid, that shares are proportional to what was received).",
      },
    },
  },
};

export async function explainPayout(facts: Record<string, unknown>): Promise<{ explanation: string; model: string }> {
  const { data, model } = await callStrictTool({
    tool,
    schema: z.object({ explanation: z.string().min(1) }),
    system:
      "You explain subcontractor payout splits to a freelancer in plain language. Use the exact amounts given; do not recompute or invent numbers. Refer to people by name or with they/them; never guess gendered pronouns.",
    effort: "low",
    maxTokens: 4000,
    user: `<payout_facts>\n${JSON.stringify(facts, null, 2)}\n</payout_facts>`,
  });
  return { explanation: data.explanation, model };
}
