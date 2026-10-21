export interface StatsDelivery { eventType: string; occurredAt: string; status: string; reason?: string; }
export interface StatsReport { schemaVersion: 1; days: Array<{ date: string; alertsByClass: Record<string, number>; suppressedByReason: Record<string, number>; remindersSent: number }>; }

function localDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("invalid delivery timestamp");
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function buildStatsReport(deliveries: readonly StatsDelivery[], sinceDays: number, now = new Date()): StatsReport {
  if (!Number.isInteger(sinceDays) || sinceDays < 1) throw new Error("--since must be a positive number of days");
  const cutoff = now.getTime() - sinceDays * 86_400_000;
  const buckets = new Map<string, StatsReport["days"][number]>();
  for (const delivery of deliveries) {
    const timestamp = Date.parse(delivery.occurredAt);
    if (!Number.isFinite(timestamp) || timestamp < cutoff) continue;
    const date = localDate(delivery.occurredAt);
    const bucket = buckets.get(date) ?? { date, alertsByClass: {}, suppressedByReason: {}, remindersSent: 0 };
    if (delivery.eventType === "reminder") bucket.remindersSent += 1;
    if (delivery.status === "delivered") bucket.alertsByClass[delivery.eventType] = (bucket.alertsByClass[delivery.eventType] ?? 0) + 1;
    if (delivery.status === "suppressed") { const reason = delivery.reason ?? "unknown"; bucket.suppressedByReason[reason] = (bucket.suppressedByReason[reason] ?? 0) + 1; }
    buckets.set(date, bucket);
  }
  return { schemaVersion: 1, days: [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date)) };
}
