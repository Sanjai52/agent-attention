export function parseMuteDuration(value: string | undefined, now = Date.now()): string {
  if (value === undefined) return new Date(now).toISOString();
  const match = /^(\d+)(s|m|h|d)$/.exec(value);
  if (match === null || Number(match[1]) <= 0) throw new Error("duration must be a positive value such as 30m");
  const units = { s: 1, m: 60, h: 3600, d: 86400 } as const;
  return new Date(now + Number(match[1]) * units[match[2] as keyof typeof units] * 1000).toISOString();
}

export function buildMuteRequest(until: string): { kind: "mute"; payload: { until: string } } {
  return { kind: "mute", payload: { until } };
}

export function buildUnmuteRequest(): { kind: "unmute"; payload: Record<string, never> } {
  return { kind: "unmute", payload: {} };
}
