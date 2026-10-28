// Writes prisma/postgres/schema.prisma: the same schema with provider = "postgresql".
// Used by the Render build (see docs/deploy.md). SQLite migrations stay local-only.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const src = readFileSync("prisma/schema.prisma", "utf8");
const out = src.replace(/provider\s*=\s*"sqlite"/, 'provider = "postgresql"');
if (out === src) throw new Error('Could not find provider = "sqlite" in prisma/schema.prisma');
mkdirSync("prisma/postgres", { recursive: true });
writeFileSync("prisma/postgres/schema.prisma", out);
console.log("Wrote prisma/postgres/schema.prisma");
