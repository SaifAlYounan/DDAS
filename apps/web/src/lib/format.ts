export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "in 3h 12m" / "2h 5m overdue" countdown against an ISO deadline. */
export function formatCountdown(dueAtIso: string, now: number = Date.now()): {
  label: string;
  overdue: boolean;
} {
  const due = new Date(dueAtIso).getTime();
  if (Number.isNaN(due)) return { label: dueAtIso, overdue: false };
  const diff = due - now;
  const abs = Math.abs(diff);
  const days = Math.floor(abs / 86_400_000);
  const hours = Math.floor((abs % 86_400_000) / 3_600_000);
  const mins = Math.floor((abs % 3_600_000) / 60_000);
  const span =
    days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  return diff >= 0
    ? { label: `in ${span}`, overdue: false }
    : { label: `${span} overdue`, overdue: true };
}

export function shortHash(hash: string, len = 12): string {
  return hash.length > len ? `${hash.slice(0, len)}…` : hash;
}

export function formatFactValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

/**
 * Coerce a free-text input into the API's fact value union. When `asList` is
 * set (the fact is list-typed), the input is split on commas into a string[] —
 * without this, editing a list fact would silently store a single joined
 * string and the engine's `in`-list rules would resolve to Unknown.
 */
export function parseFactValue(
  raw: string,
  asList = false
): string | number | boolean | string[] {
  if (asList) {
    return raw
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
  }
  const trimmed = raw.trim();
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  return raw;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
