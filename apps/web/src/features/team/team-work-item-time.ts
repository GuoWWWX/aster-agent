export function formatTeamWorkItemTime(value: string, now = new Date()): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return normalizeDisplayTime(value);

  const today = startOfDay(now);
  const targetDay = startOfDay(timestamp);
  const dayDifference = Math.round((today.getTime() - targetDay.getTime()) / 86_400_000);
  const time = `${pad(timestamp.getHours())}:${pad(timestamp.getMinutes())}`;

  if (dayDifference === 0) return time;
  if (dayDifference === 1) return `昨天 ${time}`;

  const date = `${pad(timestamp.getMonth() + 1)}-${pad(timestamp.getDate())}`;
  return timestamp.getFullYear() === now.getFullYear()
    ? `${date} ${time}`
    : `${timestamp.getFullYear()}-${date} ${time}`;
}

function normalizeDisplayTime(value: string): string {
  return value.replace(/^今天\s+/u, "");
}

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
