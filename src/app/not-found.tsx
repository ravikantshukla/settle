import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg rounded-xl border border-slate-200 bg-white p-6 text-center">
      <h1 className="text-lg font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-slate-600">That page doesn&apos;t exist.</p>
      <Link href="/" className="mt-5 inline-block rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
        Back to the dashboard
      </Link>
    </div>
  );
}
