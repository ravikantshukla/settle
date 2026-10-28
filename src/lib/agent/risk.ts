/**
 * Cached AI risk scores. A score is recomputed only when the facts Claude would see change
 * (their hash = fingerprint), never on page load.
 */
import { createHash } from "node:crypto";
import { scoreInvoiceRisk } from "@/lib/ai/riskScore";
import { prisma } from "@/lib/db";
import { agentInvoiceInclude, claudeFacts, clientHistories } from "./context";
import { COLLECTIBLE_STATUSES } from "./policy";

export interface RiskRefreshSummary {
  open: number;
  rescored: number;
  upToDate: number;
}

export async function refreshRiskScores(): Promise<RiskRefreshSummary> {
  const now = new Date();
  const invoices = await prisma.invoice.findMany({
    where: { status: { in: COLLECTIBLE_STATUSES } },
    include: { ...agentInvoiceInclude, risk: true },
  });
  const histories = await clientHistories([...new Set(invoices.map((i) => i.project.clientId))]);

  const stale = [];
  for (const inv of invoices) {
    const { today: _today, ...facts } = claudeFacts(inv, histories.get(inv.project.clientId)?.(inv.id), now); // eslint-disable-line @typescript-eslint/no-unused-vars
    const fingerprint = createHash("sha256").update(JSON.stringify(facts)).digest("hex").slice(0, 32);
    if (inv.risk?.fingerprint !== fingerprint) stale.push({ inv, facts, fingerprint });
  }

  for (let i = 0; i < stale.length; i += 20) {
    const chunk = stale.slice(i, i + 20);
    const { scores, model } = await scoreInvoiceRisk(chunk.map((s) => ({ number: s.inv.number, ...s.facts })));
    for (const s of chunk) {
      const score = scores.find((x) => x.invoice === s.inv.number);
      if (!score) continue;
      await prisma.invoiceRisk.upsert({
        where: { invoiceId: s.inv.id },
        create: { invoiceId: s.inv.id, score: score.score, reason: score.reason, fingerprint: s.fingerprint, model },
        update: { score: score.score, reason: score.reason, fingerprint: s.fingerprint, model },
      });
    }
  }
  return { open: invoices.length, rescored: stale.length, upToDate: invoices.length - stale.length };
}
