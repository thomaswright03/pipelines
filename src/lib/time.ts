// Every date the operator sees is in the operator's time zone — Arizona —
// not the server's (UTC on Vercel). Arizona doesn't observe DST, but the
// helpers below work for any IANA zone.
const APP_TIME_ZONE = process.env.NEXT_PUBLIC_APP_TIME_ZONE || "America/Phoenix";
/** How the zone is named next to times and date inputs. */
export const APP_TIME_ZONE_LABEL = APP_TIME_ZONE === "America/Phoenix" ? "Arizona time" : APP_TIME_ZONE;

function parts(date: Date, timeZone: string) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
  return values;
}

/** The zone's offset from UTC at `date`, in minutes (Phoenix: -420). */
function zoneOffsetMinutes(date: Date, timeZone: string = APP_TIME_ZONE): number {
  const p = parts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000);
}

/** "2026-09-25" — the calendar day `date` falls on in the zone. */
export function dayKey(date: Date, timeZone: string = APP_TIME_ZONE): string {
  const p = parts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** The instant the zone's calendar day began, `daysAgo` days before `now`'s day. */
export function startOfZoneDay(daysAgo: number, now: Date = new Date(), timeZone: string = APP_TIME_ZONE): Date {
  const p = parts(now, timeZone);
  const midnightAsUtc = Date.UTC(p.year, p.month - 1, p.day - daysAgo);
  // Resolve the offset at (roughly) that midnight, then correct once in case
  // it differs across a DST change.
  let guess = new Date(midnightAsUtc - zoneOffsetMinutes(new Date(midnightAsUtc), timeZone) * 60_000);
  guess = new Date(midnightAsUtc - zoneOffsetMinutes(guess, timeZone) * 60_000);
  return guess;
}

const dateTimeFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});
const dateFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  month: "short",
  day: "numeric",
  year: "numeric",
});

/** "Sep 25, 2026, 10:00 AM MST" */
export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return dateTimeFormat.format(new Date(date));
}

/** "Sep 25, 2026" */
export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return dateFormat.format(new Date(date));
}

/** A `<input type="datetime-local">` value for `date` in the app's zone. */
export function toZonedInputValue(date: Date, timeZone: string = APP_TIME_ZONE): string {
  const p = parts(date, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/**
 * Interprets a zone-less "2026-09-25T10:00" as wall-clock time in the
 * app's zone and returns that instant. Null for anything unparseable.
 */
export function parseZonedInputValue(value: string, timeZone: string = APP_TIME_ZONE): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as unknown as number[];
  const asUtc = Date.UTC(y!, mo! - 1, d!, h!, mi!);
  let guess = new Date(asUtc - zoneOffsetMinutes(new Date(asUtc), timeZone) * 60_000);
  guess = new Date(asUtc - zoneOffsetMinutes(guess, timeZone) * 60_000);
  return Number.isNaN(guess.getTime()) ? null : guess;
}
