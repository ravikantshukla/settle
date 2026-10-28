import { NextResponse } from "next/server";
import { replaceInvoiceSplits, SplitsInput, SplitValidationError } from "@/lib/payouts/splits";

export const runtime = "nodejs";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = SplitsInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  try {
    await replaceInvoiceSplits(id, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof SplitValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
