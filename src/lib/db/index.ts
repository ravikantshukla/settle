import { Prisma } from "@prisma/client";

export { prisma } from "./prisma";

/** Prisma Decimal (or null) -> plain number, for JSON / client components. */
export function num(value: Prisma.Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === "number" ? value : value.toNumber();
}
