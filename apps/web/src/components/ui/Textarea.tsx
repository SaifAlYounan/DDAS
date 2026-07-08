import type { ComponentPropsWithoutRef } from "react";
import { cx } from "../../lib/format";
import { inputClass } from "./Input";

export function Textarea({
  className,
  mono = false,
  ...rest
}: ComponentPropsWithoutRef<"textarea"> & { mono?: boolean }) {
  return <textarea className={cx(inputClass, mono && "font-mono text-xs", className)} {...rest} />;
}
