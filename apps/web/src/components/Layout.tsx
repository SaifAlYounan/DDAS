import { useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { api } from "../api/client";
import type { Me } from "../api/types";
import { getLastSimulationId } from "../lib/lastSimulation";
import { hasRole } from "./MeContext";
import { Button } from "./ui/Button";

interface NavItem {
  label: string;
  to: string;
  visible: boolean;
}

export function Layout({ me }: { me: Me }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const lastSim = getLastSimulationId();

  const items: NavItem[] = [
    { label: "Requests", to: "/requests", visible: true },
    { label: "Inbox", to: "/inbox", visible: hasRole(me, "approver") },
    { label: "Policies", to: "/policies", visible: true },
    {
      label: "Simulations",
      to: lastSim ? `/simulations/${lastSim}` : "/simulations",
      visible: lastSim !== null,
    },
    { label: "Org", to: "/org", visible: true },
    { label: "Audit", to: "/audit", visible: hasRole(me, "auditor") },
    { label: "Admin", to: "/admin", visible: hasRole(me, "admin") },
    { label: "Roles", to: "/admin/roles", visible: hasRole(me, "admin") },
  ];

  const logout = async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      // session may already be gone — proceed to login either way
    }
    queryClient.clear();
    void navigate({ to: "/login" });
  };

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 flex w-52 flex-col border-r border-gray-200 bg-white">
        <div className="flex items-center gap-2 px-5 py-5">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-600 text-xs font-bold text-white">
            D
          </span>
          <span className="text-sm font-semibold tracking-tight text-gray-900">
            LQGovernance - DDAS Console
          </span>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-3">
          {items
            .filter((i) => i.visible)
            .map((item) => (
              <Link
                key={item.label}
                to={item.to}
                className="rounded-md px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                activeProps={{
                  className:
                    "rounded-md px-3 py-2 text-sm font-medium bg-indigo-50 text-indigo-700",
                }}
                activeOptions={{ exact: false }}
              >
                {item.label}
              </Link>
            ))}
        </nav>
        <div className="border-t border-gray-100 px-5 py-4">
          <p className="truncate text-sm font-medium text-gray-900">{me.name}</p>
          <p className="truncate text-xs text-gray-500">{me.roles.join(" · ") || "no roles"}</p>
        </div>
      </aside>
      <div className="ml-52 flex min-h-screen flex-1 flex-col">
        <header className="sticky top-0 z-40 flex items-center justify-end gap-3 border-b border-gray-200 bg-white/90 px-6 py-2.5 backdrop-blur">
          <span className="text-sm text-gray-600">{me.email ?? me.name}</span>
          <Button variant="secondary" size="sm" onClick={() => void logout()}>
            Log out
          </Button>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
