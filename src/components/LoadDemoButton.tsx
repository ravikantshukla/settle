"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/Toast";
import { postJson } from "@/lib/api";

export function LoadDemoButton() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await postJson("/api/demo/reset");
          toast.success("Demo invoices created", "Real PayPal sandbox invoices, addressed to your sandbox buyer.");
          router.refresh();
        } catch (e) {
          toast.error("Couldn't load demo data", e instanceof Error ? e.message : String(e));
        } finally {
          setBusy(false);
        }
      }}
      className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
    >
      {busy ? "Creating sandbox invoices (~30s)…" : "Load demo data"}
    </button>
  );
}
