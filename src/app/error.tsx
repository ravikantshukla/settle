"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg rounded-xl border border-red-200 bg-white p-6 text-center">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-slate-600">
        {error.message.includes("DATABASE_URL") || error.message.includes("prisma")
          ? "The database isn't reachable. Check DATABASE_URL and that migrations have run (npm run db:migrate)."
          : "This page failed to load. Try again; if it keeps happening, check the server log."}
      </p>
      {error.digest && <p className="mt-2 font-mono text-xs text-slate-400">ref {error.digest}</p>}
      <div className="mt-5 flex justify-center gap-2">
        <button onClick={reset} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
          Try again
        </button>
        <Link href="/" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50">
          Dashboard
        </Link>
      </div>
    </div>
  );
}
