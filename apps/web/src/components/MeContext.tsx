import { createContext, useContext } from "react";
import type { Me } from "../api/types";

export const MeContext = createContext<Me | null>(null);

export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error("useMe must be used inside the authenticated shell");
  return me;
}

/** Mirror the server's guard: admin satisfies every role check. */
export function hasRole(me: Me, ...roles: string[]): boolean {
  return me.roles.includes("admin") || roles.some((r) => me.roles.includes(r));
}
