import { num, prisma } from "@/lib/db";
import { SplitEditor, type EditableInvoice } from "./SplitEditor";
import { SubcontractorList, type SubRow } from "./SubcontractorList";

export const dynamic = "force-dynamic";
export const metadata = { title: "Subcontractors" };

export default async function SubcontractorsPage() {
  const [subs, projects] = await Promise.all([
    prisma.subcontractor.findMany({
      orderBy: { name: "asc" },
      include: { splits: { include: { payouts: true } } },
    }),
    prisma.project.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        client: true,
        invoices: {
          where: { status: { notIn: ["CANCELLED", "REFUNDED", "MARKED_AS_REFUNDED"] } },
          orderBy: { issueDate: "desc" },
          include: { payoutSplits: { include: { payouts: { select: { id: true } } } } },
        },
      },
    }),
  ]);

  const rows: SubRow[] = subs.map((s) => ({
    id: s.id,
    name: s.name,
    paypalEmail: s.paypalEmail,
    isDemo: s.isDemo,
    splitCount: s.splits.length,
    paidOut: s.splits
      .flatMap((sp) => sp.payouts)
      .filter((p) => p.status === "SUCCESS")
      .reduce((sum, p) => sum + num(p.amount), 0),
  }));

  const options = subs.map((s) => ({ id: s.id, name: s.name }));
  const withInvoices = projects.filter((p) => p.invoices.length);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Subcontractors</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">
          People who get a share of an invoice. When the client pays, the agent proposes a PayPal payout of each share
          (proportional to what&apos;s been paid so far), and you approve it.
        </p>
      </div>

      <SubcontractorList rows={rows} />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Splits by project</h2>
        {withInvoices.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-8 text-center text-sm text-slate-500">
            No invoices yet. Splits are set per invoice once a project has one.
          </div>
        ) : (
          <div className="space-y-4">
            {withInvoices.map((project) => (
              <div key={project.id} className="rounded-xl border border-slate-200 bg-white">
                <div className="border-b border-slate-100 px-4 py-3">
                  <p className="font-medium">{project.title}</p>
                  <p className="text-xs text-slate-500">{project.client.company ?? project.client.name}</p>
                </div>
                <div className="divide-y divide-slate-100">
                  {project.invoices.map((inv) => {
                    const editable: EditableInvoice = {
                      id: inv.id,
                      number: inv.number,
                      status: inv.status,
                      currency: inv.currency,
                      amount: num(inv.amount),
                      isDemo: inv.isDemo,
                      splits: inv.payoutSplits.map((s) => ({
                        id: s.id,
                        subcontractorId: s.subcontractorId,
                        mode: s.percentage !== null ? "percentage" : "fixed",
                        value: String(s.percentage !== null ? num(s.percentage) : num(s.fixedAmount)),
                        locked: s.payouts.length > 0,
                      })),
                    };
                    return <SplitEditor key={inv.id} invoice={editable} subcontractors={options} />;
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
