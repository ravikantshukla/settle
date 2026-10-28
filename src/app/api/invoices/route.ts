import { NextResponse } from "next/server";
import { ReviewedInvoiceSchema } from "@/lib/invoices/schema";
import { sendNewInvoice, SendInvoiceError } from "@/lib/invoices/sendNewInvoice";

export const runtime = "nodejs";

/** Approve & send: create the invoice locally and in PayPal, then send it. */
export async function POST(req: Request) {
  const parsed = ReviewedInvoiceSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Please fix the highlighted fields.",
        fieldErrors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(await sendNewInvoice(parsed.data));
  } catch (e) {
    if (e instanceof SendInvoiceError) {
      return NextResponse.json({ error: e.message, stage: e.stage, invoiceId: e.invoiceId }, { status: e.stage === "config" ? 400 : 502 });
    }
    console.error("send invoice failed", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Sending failed" }, { status: 500 });
  }
}
