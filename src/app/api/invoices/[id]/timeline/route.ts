import { NextResponse } from "next/server";
import { invoiceTimeline } from "@/lib/invoices/timeline";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const timeline = await invoiceTimeline(id);
  if (!timeline) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  return NextResponse.json(timeline);
}
