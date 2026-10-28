# Deploying to Render

Local dev uses SQLite with real migrations in `prisma/migrations`. Production uses Postgres,
generated from the same schema with the provider swapped.

1. Create a Render Postgres instance and a Web Service for this repo.
2. Web Service settings:
   - Build command: `npm ci && npm run build:render`
   - Start command: `npm start`
3. Environment: everything in `.env.example`, with `DATABASE_URL` set to the Render Postgres
   internal URL and `APP_BASE_URL` set to the service's public URL.
4. (Optional) seed demo data once from the Render shell:
   `npx prisma db seed` won't work against the SQLite schema, so run
   `npx prisma generate --schema prisma/postgres/schema.prisma && npx tsx prisma/seed.ts`.

`build:render` writes `prisma/postgres/schema.prisma` (provider = postgresql), generates the client
from it, and runs `prisma db push` to sync tables. It is a hackathon-grade setup; there are no
Postgres migration files.
