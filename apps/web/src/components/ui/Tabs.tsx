import { cx } from "../../lib/format";

export interface TabDef {
  id: string;
  label: string;
  disabled?: boolean;
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: TabDef[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <nav className="flex gap-1 border-b border-gray-200" aria-label="Tabs">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          disabled={tab.disabled === true}
          onClick={() => onChange(tab.id)}
          className={cx(
            "-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
            active === tab.id
              ? "border-indigo-600 text-indigo-600"
              : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700",
            tab.disabled === true && "cursor-not-allowed opacity-40 hover:border-transparent"
          )}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
