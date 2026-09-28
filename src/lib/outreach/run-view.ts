// What a pipeline page shows about its daily runs: the recent runs as the
// settings panel lists them, and the warning when the schedule seems to
// have stopped.
import type { PipelineRun } from "@/generated/prisma/client";
import type { RunView } from "@/components/DailyRunSettings";
import type { PipelineScheduleData } from "@/lib/pipeline-schedule-rules";
import { displayRunStatus, isRunOverdue } from "@/lib/outreach/runs";
import { formatDateTime } from "@/lib/time";

export function toRunViews(runs: PipelineRun[]): RunView[] {
  return runs.map((r) => ({
    id: r.id,
    status: displayRunStatus(r),
    startedAt: formatDateTime(r.startedAt),
    summary: r.summary ?? (displayRunStatus(r) === "interrupted" ? "The run was cut off before it could record what it did." : null),
    errors: r.errors ? r.errors.split("\n").filter(Boolean) : [],
    numbers:
      r.businessesChecked !== null && r.leadsFound !== null && r.emailsSent !== null
        ? { businessesChecked: r.businessesChecked, leadsFound: r.leadsFound, emailsSent: r.emailsSent }
        : null,
  }));
}

/** A warning when the daily run is on and should be running, but the last one was over a day ago. */
export function staleRunWarning(schedule: PipelineScheduleData, paused: boolean, lastRun: PipelineRun | undefined): string | null {
  return schedule.enabled && !paused && lastRun && isRunOverdue(lastRun.startedAt)
    ? `The last daily run was ${formatDateTime(lastRun.startedAt)} — more than a day ago. The automatic schedule may have stopped — ask your developer to check it.`
    : null;
}
