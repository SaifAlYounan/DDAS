import type { ComponentPropsWithoutRef } from "react";
import { cx } from "../../lib/format";
import { inputClass } from "./Input";

export function Select({ className, children, ...rest }: ComponentPropsWithoutRef<"select">) {
  return (
    <select className={cx(inputClass, "pr-8", className)} {...rest}>
      {children}
    </select>
  );
}
