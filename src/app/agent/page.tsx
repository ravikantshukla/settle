import { clock } from "@/lib/clock";
import { num, prisma } from "@/lib/db";
import { daysOverdue } from "@/lib/agent/policy";
import { ActionCard, type InboxAction } from "./ActionCard";
import { RunAgentButton } from "./RunAgentButton";
import { Timeline, type TimelineItem } from "./Timeline";

export const dynamic = "force-dynamic";
export const metadata = { title: "Agent inbox" };

export default async function AgentPage() {
  const now = await clock.now();
  const [pending, decided, runs] = await Promise.all([
    prisma.agentAction.findMany({
      where: { status: { in: ["PROPOSED", "APPROVED"] } },
      orderBy: { proposedAt: "desc" },
      include: { invoice: { include: { project: { include: { client: true } } } } },
    }),
    prisma.agentAction.findMany({
      where: { status: { in: ["EXECUTED", "FAILED", "REJECTED"] } },
      orderBy: { updatedAt: "desc" },
      take: 30,
      include: { invoice: { select: { number: true } } },
    }),
    prisma.agentRunLog.findMany({ orderBy: { createdAt: "desc" }, take: 15 }),
  ]);

  const inbox: InboxAction[] = pending.map((a) => ({
    id: a.id,
    type: a.type,
    status: a.status,
    reasoning: a.reasoning,
    payload: a.payload as Record<string, unknown>,
    proposedAt: a.proposedAt.toISOString(),
    isDemo: a.isDemo,
    invoice: a.invoice && {
      number: a.invoice.number,
      currency: a.invoice.currency,
      amount: num(a.invoice.amount),
      outstanding: num(a.invoice.amount) - num(a.invoice.amountPaid),
      daysOverdue: daysOverdue(a.invoice.dueDate, now),
      client: a.invoice.project.client.company ?? a.invoice.project.client.name,
      project: a.invoice.project.title,
      payerViewUrl: a.invoice.payerViewUrl,
    },
  }));

  const timeline: TimelineItem[] = [
    ...runs.map((r) => ({
      kind: "run" as const,
      id: r.id,
      at: r.createdAt.toISOString(),
      trigger: r.trigger,
      decision: r.decision,
      model: r.model,
      observations: Array.isArray(r.observations) ? (r.observations as Array<Record<string, unknown>>) : [r.observations as Record<string, unknown>],
    })),
    ...decided.map((a) => ({
      kind: "action" as const,
      id: a.id,
      at: (a.executedAt ?? a.decidedAt ?? a.updatedAt).toISOString(),
      type: a.type,
      status: a.status,
      invoiceNumber: a.invoice?.number ?? null,
      result: (a.result ?? null) as Record<string, unknown> | null,
      subject: ((a.payload as Record<string, unknown> | null)?.subject as string | undefined) ?? null,
    })),
  ].sort((x, y) => y.at.localeCompare(x.at));

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agent</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            The agent watches unpaid invoices and drafts reminders, payment plans and subcontractor payouts. Nothing is
            sent or paid until you approve it here.
          </p>
        </div>
        <div className="ml-auto">
          <RunAgentButton />
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Needs your approval
          <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs font-semibold text-white">{inbox.length}</span>
        </h2>
        {inbox.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
            <p className="font-medium">You&apos;re all caught up</p>
            <p className="mt-1 text-sm text-slate-500">No proposals waiting. Run the agent to check open invoices now.</p>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {inbox.map((a) => (
              <ActionCard key={a.id} action={a} now={now.toISOString()} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Activity</h2>
        <Timeline items={timeline} now={now.toISOString()} />
      </section>
    </div>
  );
}
