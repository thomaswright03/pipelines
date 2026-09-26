// How the email finder's addresses do in production, per pipeline and per
// version of the address rules (see src/lib/outreach/finder-quality.ts).
import { formatDate } from "@/lib/time";
import { PIPELINE_LABEL } from "@/lib/outreach/pipeline-id";
import type { AddressSource, FinderQuality as FinderQualityData, FinderQualityRow } from "@/lib/outreach/finder-quality";

const SOURCE_LABEL: Record<AddressSource, string> = {
  found: "Found by the lookup",
  checked: "Found by the lookup, then checked by you",
  hand: "Typed in by hand",
  unknown: "Source not recorded (older leads)",
};

function share(n: number, of: number): string {
  if (of === 0) return "—";
  return `${n.toLocaleString("en-US")} of ${of.toLocaleString("en-US")} (${((100 * n) / of).toFixed(1)}%)`;
}

function RowLabel({ row }: { row: FinderQualityRow }) {
  return (
    <div className="min-w-0">
      <div className="font-medium">{SOURCE_LABEL[row.source]}</div>
      {row.source === "found" && (
        <div className="break-words text-xs muted">
          {row.rulesVersion ? (
            <>
              Rules <code>{row.rulesVersion}</code>
            </>
          ) : (
            "Found before rule versions were recorded"
          )}
          {row.firstSent && ` · first emailed ${formatDate(row.firstSent)}`}
        </div>
      )}
    </div>
  );
}

export default function FinderQuality({ data }: { data: FinderQualityData }) {
  return (
    <div className="flex flex-col gap-4">
      {data.pipelines.map(({ pipeline, rows }) => (
        <div key={pipeline} className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">{PIPELINE_LABEL[pipeline]}</h3>
          {rows.length === 0 ? (
            <p className="text-sm muted">No emails sent in the last {data.sinceDays} days.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
              {rows.map((row) => (
                <li key={`${row.source}|${row.rulesVersion ?? ""}`} className="flex flex-col gap-1 py-2">
                  <RowLabel row={row} />
                  <dl className="grid grid-cols-1 gap-x-4 gap-y-0.5 tabular-nums sm:grid-cols-3">
                    <div className="flex gap-1">
                      <dt className="muted">Bounced:</dt>
                      <dd>{share(row.bounced, row.sends)}</dd>
                    </div>
                    <div className="flex gap-1">
                      <dt className="muted">“Wrong person” replies:</dt>
                      <dd>{share(row.wrongPerson, row.leadsEmailed)}</dd>
                    </div>
                    {row.source === "found" && (
                      <div className="flex gap-1">
                        <dt className="muted">Replaced by you before sending:</dt>
                        <dd>{row.corrected.toLocaleString("en-US")}</dd>
                      </div>
                    )}
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
