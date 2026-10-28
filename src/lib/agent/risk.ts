/**
 * Risk = rule-based score (computed live, no AI) + an AI-written one-line reason that is cached
 * per invoice and regenerated only when the invoice's state changes (fingerprint).
 */
import { createHash } from "node:crypto";
import { writeRiskReasons } from "@/lib/ai/riskScore";
import { clock } from "@/lib/clock";
import { num, prisma } from "@/lib/db";
import { agentInvoiceInclude, clientHistories, contactHistory, type AgentInvoice, type ClientHistory } from "./context";
import { COLLECTIBLE_STATUSES, hasHardshipSignal, invoiceStage, riskScore, type RiskScore } from "./policy";

export interface InvoiceRiskView extends RiskScore {
  stage: string;
  /** Hash of the state the reason describes; the cached reason is valid while it matches. */
  fingerprint: string;
}

/** Rule-based risk for one invoice. */
export function riskFor(inv: AgentInvoice, history: ClientHistory | undefined, now: Date): InvoiceRiskView | null {
  const contacts = contactHistory(inv);
  const input = {
    status: inv.status,
    dueDate: inv.dueDate,
    amount: num(inv.amount),
    amountPaid: num(inv.amountPaid),
    reminderCount: contacts.filter((c) => c.type === "SEND_REMINDER").length,
    planOffered: contacts.some((c) => c.type === "OFFER_PAYMENT_PLAN"),
    hardshipSignal: hasHardshipSignal(inv.project.client.notes),
    history: history ?? null,
  };
  const scored = riskScore(input, now);
  if (!scored) return null;
  const stage = invoiceStage(inv.dueDate, now);
  // State, not the day count: the reason only changes when something meaningful happens.
  const fingerprint = createHash("sha256")
    .update(JSON.stringify([inv.status, input.amountPaid, stage, input.reminderCount, input.planOffered, input.hardshipSignal, Math.round(scored.score / 10)]))
    .digest("hex")
    .slice(0, 32);
  return { ...scored, stage, fingerprint };
}

/** Fallback reason built from the rule drivers (used until, or instead of, an AI-written one). */
export function ruleReason(r: RiskScore): string {
  const text = r.drivers.slice(0, 2).join("; ");
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "No risk factors";
}

export interface RiskRefreshSummary {
  open: number;
  rewritten: number;
  upToDate: number;
  fallback: boolean;
}

/** Regenerate AI reasons for invoices whose state changed. Falls back to rule text if the AI fails. */
export async function refreshRiskReasons(): Promise<RiskRefreshSummary> {
  const now = await clock.now();
  const invoices = await prisma.invoice.findMany({
    where: { status: { in: COLLECTIBLE_STATUSES } },
    include: { ...agentInvoiceInclude, risk: true },
  });
  const histories = await clientHistories([...new Set(invoices.map((i) => i.project.clientId))]);

  const stale: Array<{ inv: (typeof invoices)[number]; risk: InvoiceRiskView }> = [];
  for (const inv of invoices) {
    const risk = riskFor(inv, histories.get(inv.project.clientId)?.(inv.id), now);
    if (risk && inv.risk?.fingerprint !== risk.fingerprint) stale.push({ inv, risk });
  }

  let fallback = false;
  for (let i = 0; i < stale.length; i += 20) {
    const chunk = stale.slice(i, i + 20);
    let reasons = new Map<string, string>();
    let model: string | null = null;
    try {
      const r = await writeRiskReasons(
        chunk.map(({ inv, risk }) => ({ number: inv.number, score: risk.score, drivers: risk.drivers, stage: risk.stage, clientNotes: inv.project.client.notes })),
      );
      reasons = r.reasons;
      model = r.model;
    } catch (e) {
      fallback = true;
      console.warn(`AI risk reasons failed; using rule text: ${e instanceof Error ? e.message : e}`);
    }
    for (const { inv, risk } of chunk) {
      const reason = reasons.get(inv.number) ?? ruleReason(risk);
      const data = { score: risk.score, reason, fingerprint: risk.fingerprint, model: reasons.has(inv.number) ? model : null };
      await prisma.invoiceRisk.upsert({ where: { invoiceId: inv.id }, create: { invoiceId: inv.id, ...data }, update: data });
    }
  }
  return { open: invoices.length, rewritten: stale.length, upToDate: invoices.length - stale.length, fallback };
}
