import { STATUS_COLOR, STATUS_DOT, statusLabel, type LeadStatus } from "@/lib/lead-status";

export default function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${
        STATUS_COLOR[status as LeadStatus] ?? STATUS_COLOR.new
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status as LeadStatus] ?? "bg-zinc-400"}`} aria-hidden />
      {statusLabel(status)}
    </span>
  );
}
