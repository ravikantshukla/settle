import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { ToastProvider } from "@/components/Toast";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Settle",
  description: "AI collections agent for freelancers, powered by PayPal",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}>
        <header className="border-b border-slate-200 bg-white">
          <nav className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3 text-sm">
            <Link href="/" className="text-base font-semibold tracking-tight">
              Settle
            </Link>
            <Link href="/" className="text-slate-600 hover:text-slate-900">
              Invoices
            </Link>
            <Link href="/invoices/new" className="text-slate-600 hover:text-slate-900">
              New invoice
            </Link>
            <Link href="/agent" className="text-slate-600 hover:text-slate-900">
              Agent
            </Link>
            <span className="ml-auto rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
              PayPal sandbox
            </span>
          </nav>
        </header>
        <ToastProvider>
          <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
        </ToastProvider>
      </body>
    </html>
  );
}
