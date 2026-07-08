import type { ReactNode } from "react";
import { cx } from "../../lib/format";

export function Table({
  head,
  children,
  className,
}: {
  head: ReactNode[];
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("overflow-x-auto rounded-lg border border-gray-200 bg-white", className)}>
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            {head.map((h, i) => (
              <th
                key={i}
                scope="col"
                className="px-4 py-2.5 text-left text-xs font-semibold tracking-wide text-gray-500 uppercase"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({
  children,
  className,
  colSpan,
}: {
  children?: ReactNode;
  className?: string;
  colSpan?: number;
}) {
  const props = colSpan === undefined ? {} : { colSpan };
  return (
    <td className={cx("px-4 py-2.5 align-top text-gray-700", className)} {...props}>
      {children}
    </td>
  );
}

export function EmptyRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <tr>
      <Td colSpan={colSpan} className="py-8 text-center text-gray-400">
        {message}
      </Td>
    </tr>
  );
}
