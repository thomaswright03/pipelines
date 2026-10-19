import type { NextRequest } from "next/server";
import { ROOM_DESIGNER_SCHEDULE_ID } from "@/lib/pipeline-schedule";
import { handleDailyCron } from "@/lib/outreach/daily-cron";
import { runDailyRoomDesigner } from "@/lib/room-designer-daily-run";

// The Room Designer 3D run (vercel.json: "0 16 * * 1-5", 9:00 AM Arizona
// time, Monday to Friday). It sends the whole day's number in one run, so it
// gets Hobby's 300 s limit under Fluid compute (vercel.json "fluid": true).
// While sending is held in code (room-designer-config.ts) it only finds
// remodelers. Auth, the on/off switch, recording and errors: handleDailyCron.
export const maxDuration = 300;

export function GET(request: NextRequest) {
  return handleDailyCron(request, {
    pipeline: "room-designer",
    scheduleId: ROOM_DESIGNER_SCHEDULE_ID,
    logScope: "api.cron.room-designer-daily",
    run: (emailsPerDay) => runDailyRoomDesigner(emailsPerDay),
  });
}
