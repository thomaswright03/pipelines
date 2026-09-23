"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  runPipelineScrapeAction,
  searchLeadsAction,
  sendAllOutreachEmailsAction,
  findAllLeadEmailsAction,
  type LeadSearchState,
} from "@/lib/actions/vault-pipeline";

const initialSearchState: LeadSearchState = {};

export default function VaultControls() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [emailProgress, setEmailProgress] = useState<{ checked: number; found: number; total: number } | null>(null);
  const [searchState, searchAction, searchPending] = useActionState(searchLeadsAction, initialSearchState);
  const [showManualSearch, setShowManualSearch] = useState(false);

  function runAndRefresh(label: string, fn: () => Promise<unknown>) {
    setMessage(null);
    startTransition(async () => {
      const result = await fn();
      setMessage(describeResult(label, result));
      router.refresh();
    });
  }

  function runFindAllEmails() {
    setMessage(null);
    setEmailProgress(null);
    startTransition(async () => {
      let checkedSoFar = 0;
      let foundSoFar = 0;
      let remaining = 1;
      while (remaining > 0) {
        const result = await findAllLeadEmailsAction();
        checkedSoFar += result.checked;
        foundSoFar += result.found;
        remaining = result.remaining;
        setEmailProgress({ checked: checkedSoFar, found: foundSoFar, total: checkedSoFar + remaining });
        if (result.checked === 0) break; // nothing left this round — avoid spinning forever
      }
      setEmailProgress(null);
      setMessage(`Find emails: checked ${checkedSoFar} leads, found ${foundSoFar} emails.`);
      router.refresh();
    });
  }

  return (
    <div className="card flex flex-col gap-3 p-4">
      <div className="flex flex-wrap gap-2">
        <ActionButton disabled={isPending} onClick={() => runAndRefresh("Run pipeline", runPipelineScrapeAction)} primary>
          Run pipeline (find leads in next city)
        </ActionButton>
        <ActionButton disabled={isPending} onClick={() => setShowManualSearch((v) => !v)}>
          Search a specific city
        </ActionButton>
        <ActionButton disabled={isPending} onClick={() => runAndRefresh("Send outreach", sendAllOutreachEmailsAction)}>
          Send outreach to all new leads
        </ActionButton>
        <ActionButton disabled={isPending} onClick={runFindAllEmails}>
          Find emails for all leads
        </ActionButton>
      </div>

      {emailProgress && (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Finding emails… {emailProgress.checked}/{emailProgress.total} checked, {emailProgress.found} found.
          </p>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-300"
              style={{ width: `${Math.min((emailProgress.checked / Math.max(emailProgress.total, 1)) * 100, 100)}%` }}
            />
          </div>
        </div>
      )}
      {!emailProgress && message && <p className="text-sm text-zinc-600 dark:text-zinc-400">{message}</p>}
      <p className="text-xs text-zinc-500">
        Only businesses an email was actually found for get saved. Yelp doesn&apos;t give a website, so
        each run guesses one from the business&apos;s name (a handful of plausible domains, checked
        directly — no search engine involved) before looking for an email on it. This is a low-accuracy
        heuristic, so most runs will still add fewer leads than they scrape. No automatic reply/bounce
        detection yet — when a lead replies or an email bounces, open their page and click &quot;Mark
        replied&quot; or &quot;Mark bounced&quot;.
      </p>

      {showManualSearch && (
        <form action={searchAction} className="flex flex-wrap items-end gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <Field name="city" label="City" placeholder="Provo" required />
          <Field name="state" label="State" placeholder="UT" required />
          <Field name="businessType" label="Business type (optional)" placeholder="dentist" />
          <button type="submit" disabled={searchPending} className="btn-primary">
            {searchPending ? "Searching…" : "Search"}
          </button>
          {searchState.error && <p className="w-full text-sm text-red-600 dark:text-red-400">{searchState.error}</p>}
          {searchState.created !== undefined && (
            <p className="w-full text-sm text-zinc-600 dark:text-zinc-400">
              Found {searchState.scraped} businesses, added {searchState.created} new.
            </p>
          )}
        </form>
      )}
    </div>
  );
}

function describeResult(label: string, result: unknown): string {
  if (result && typeof result === "object") {
    if ("error" in result && (result as { error?: string }).error) {
      return `${label}: ${(result as { error: string }).error}`;
    }
    if ("created" in result) {
      const r = result as { city: string; state: string; created: number; scraped: number };
      return `${label}: scraped ${r.scraped} in ${r.city}, ${r.state} — added ${r.created} new.`;
    }
    if ("sent" in result) {
      const r = result as { sent: number; failed: number; errors: string[] };
      return `${label}: sent ${r.sent}${r.failed ? `, ${r.failed} failed (${r.errors[0]})` : ""}.`;
    }
  }
  return `${label}: done.`;
}

function ActionButton({
  children,
  onClick,
  disabled,
  primary,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled} className={primary ? "btn-primary" : "btn-secondary"}>
      {children}
    </button>
  );
}

function Field({
  name,
  label,
  placeholder,
  required,
}: {
  name: string;
  label: string;
  placeholder: string;
  required?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-zinc-500">
      {label}
      <input name={name} placeholder={placeholder} required={required} className="input w-36" />
    </label>
  );
}
