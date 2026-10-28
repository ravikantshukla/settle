/** `npm run db:seed`: replace demo rows with fresh demo data (real data is kept). */
import { PrismaClient } from "@prisma/client";
import { seedDemo } from "../src/lib/demo/seed";

const prisma = new PrismaClient();

seedDemo(prisma)
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
