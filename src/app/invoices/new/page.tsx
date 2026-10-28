import { NewInvoiceFlow } from "./NewInvoiceFlow";

export const metadata = { title: "New invoice" };

export default function NewInvoicePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New invoice from agreement</h1>
        <p className="mt-1 text-sm text-slate-600">
          Paste a project agreement or email thread. Settle drafts the invoice, you review it, and nothing is sent until
          you approve.
        </p>
      </div>
      <NewInvoiceFlow />
    </div>
  );
}
