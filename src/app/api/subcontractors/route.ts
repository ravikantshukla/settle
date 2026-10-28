import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { SubcontractorInput } from "@/lib/payouts/splits";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const parsed = SubcontractorInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const sub = await prisma.subcontractor.create({ data: parsed.data });
  return NextResponse.json(sub, { status: 201 });
}
