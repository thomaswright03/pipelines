"use client";

import { updateVaultScheduleAction } from "@/lib/actions/pipeline-schedule";
import DailyRunSettings from "@/components/DailyRunSettings";

/** The Cold Outreach page's daily-run settings (see DailyRunSettings). */
export default function VaultScheduleSettings(props: Omit<React.ComponentProps<typeof DailyRunSettings>, "pipeline" | "action">) {
  return <DailyRunSettings {...props} pipeline="cold-outreach" action={updateVaultScheduleAction} />;
}
