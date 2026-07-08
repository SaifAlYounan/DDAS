import type { ReactNode } from "react";
import { cx } from "../../lib/format";

export type BadgeTone = "gray" | "green" | "red" | "amber" | "indigo" | "blue";

const TONES: Record<BadgeTone, string> = {
  gray: "bg-gray-100 text-gray-700 ring-gray-500/10",
  green: "bg-green-50 text-green-700 ring-green-600/20",
  red: "bg-red-50 text-red-700 ring-red-600/20",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/20",
  indigo: "bg-indigo-50 text-indigo-700 ring-indigo-600/20",
  blue: "bg-blue-50 text-blue-700 ring-blue-600/20",
};

export function Badge({
  tone = "gray",
  children,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap",
        TONES[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

/** Tone for a request lifecycle state. */
export function stateTone(state: string): BadgeTone {
  switch (state) {
    case "extracting":
      return "blue";
    case "facts_review":
    case "pending_approval":
      return "amber";
    case "classified":
      return "indigo";
    case "decided":
      return "green";
    case "failed":
    case "cancelled":
      return "red";
    default:
      return "gray";
  }
}
