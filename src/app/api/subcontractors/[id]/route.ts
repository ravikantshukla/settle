import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { SubcontractorInput } from "@/lib/payouts/splits";

export const runtime = "nodejs";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = SubcontractorInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const exists = await prisma.subcontractor.findUnique({ where: { id } });
  if (!exists) return NextResponse.json({ error: "Subcontractor not found" }, { status: 404 });
  return NextResponse.json(await prisma.subcontractor.update({ where: { id }, data: parsed.data }));
}
