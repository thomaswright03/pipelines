import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
      <span className="accent-text text-5xl font-bold">404</span>
      <p className="text-lg font-medium">This page doesn&apos;t exist.</p>
      <p className="max-w-sm text-sm muted">
        The link might be old, or the lead might have been removed. Head back to the dashboard.
      </p>
      <Link href="/" className="btn-primary mt-2">
        Back to dashboard
      </Link>
    </div>
  );
}
