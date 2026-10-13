import type { ScheduledTaskRecurrence } from "@agent/protocol";

export function nextScheduledTime(recurrence: ScheduledTaskRecurrence, after: Date): string | null {
  if (recurrence.kind === "once") return Date.parse(recurrence.at) > after.getTime() ? recurrence.at : null;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: recurrence.timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const wallTime = (instant: number): number => {
    const parts = Object.fromEntries(formatter.formatToParts(instant).map((part) => [part.type, part.value]));
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second));
  };
  const localNow = new Date(wallTime(after.getTime()));
  const [hour, minute] = recurrence.time.split(":").map(Number);
  for (let day = 0; day <= 7; day++) {
    const nominal = Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate() + day, hour, minute);
    if (recurrence.kind === "weekly" && !recurrence.weekdays.includes(new Date(nominal).getUTCDay())) continue;
    const candidates = [-86_400_000, 0, 86_400_000].map((shift) => {
      const sample = nominal + shift;
      return nominal - (wallTime(sample) - sample);
    }).filter((candidate) => wallTime(candidate) === nominal);
    // A repeated autumn wall time is executed once, at its earliest occurrence.
    const earliest = Math.min(...candidates);
    if (Number.isFinite(earliest) && earliest > after.getTime()) return new Date(earliest).toISOString();
  }
  return null;
}
