import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { isValidTimeZone } from "@/lib/timezone";

export const runtime = "nodejs";

const Body = z.object({
  timezone: z
    .string()
    .trim()
    .refine((tz) => tz === "" || isValidTimeZone(tz), "Use an IANA timezone, e.g. Europe/London")
    .optional(),
  country: z
    .string()
    .trim()
    .regex(/^([A-Za-z]{2})?$/, "2-letter country code, e.g. GB")
    .optional(),
});

/** Edit a client's timezone / country (empty string clears it). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  const { timezone, country } = parsed.data;
  const client = await prisma.client.update({
    where: { id },
    data: {
      ...(timezone !== undefined && { timezone: timezone || null }),
      ...(country !== undefined && { country: country ? country.toUpperCase() : null }),
    },
    select: { id: true, timezone: true, country: true },
  }).catch(() => null);
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  return NextResponse.json(client);
}
