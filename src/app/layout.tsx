import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppHeader } from "@/components/AppHeader";
import { ToastProvider } from "@/components/Toast";
import { prisma } from "@/lib/db";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Settle: AI collections agent", template: "%s · Settle" },
  description: "Settle drafts PayPal invoices from your agreements, chases late payments, and pays your subcontractors, with you approving every step.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const pendingActions = await prisma.agentAction.count({ where: { status: "PROPOSED" } }).catch(() => 0);

  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} flex min-h-screen flex-col font-sans antialiased`}>
        <ToastProvider>
          <AppHeader demoMode={process.env.DEMO_MODE === "true"} pendingActions={pendingActions} />
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-8">{children}</main>
          <footer className="border-t border-slate-200 bg-white">
            <p className="mx-auto max-w-6xl px-4 py-4 text-xs text-slate-500">
              Settle runs on the <b>PayPal sandbox</b>: invoices, reminders and payouts use test accounts, and no real money moves.
              Every client-facing or money-moving step waits for your approval.
            </p>
          </footer>
        </ToastProvider>
      </body>
    </html>
  );
}
