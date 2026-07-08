import { useQuery } from "@tanstack/react-query";
import {
  Navigate,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { meQuery } from "./api/queries";
import { Layout } from "./components/Layout";
import { Loading } from "./components/Loading";
import { MeContext } from "./components/MeContext";
import { AdminPage } from "./pages/Admin";
import { AuditPage } from "./pages/Audit";
import { InboxPage } from "./pages/Inbox";
import { LoginPage } from "./pages/Login";
import { NewRequestPage } from "./pages/NewRequest";
import { OrgPage } from "./pages/Org";
import { PoliciesPage, PolicyVersionsPage } from "./pages/Policies";
import { PolicyVersionPage } from "./pages/PolicyVersion";
import { RequestDetailPage } from "./pages/RequestDetail";
import { RequestsPage } from "./pages/Requests";
import { SimulationPage } from "./pages/Simulation";

const rootRoute = createRootRoute();

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
});

/** Everything below requires a session: /auth/me 401 → /login. */
function AuthedShell() {
  const me = useQuery(meQuery);
  if (me.isPending) return <Loading label="Checking session…" />;
  if (me.isError || !me.data) return <Navigate to="/login" replace />;
  return (
    <MeContext.Provider value={me.data}>
      <Layout me={me.data} />
    </MeContext.Provider>
  );
}

const authedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "authed",
  component: AuthedShell,
});

const indexRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/requests" });
  },
});

const requestsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/requests",
  component: RequestsPage,
});

const newRequestRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/requests/new",
  component: NewRequestPage,
});

interface RequestSearch {
  tab?: string;
  task?: string;
}

const requestDetailRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/requests/$id",
  validateSearch: (search: Record<string, unknown>): RequestSearch => {
    const out: RequestSearch = {};
    if (typeof search["tab"] === "string") out.tab = search["tab"];
    if (typeof search["task"] === "string") out.task = search["task"];
    return out;
  },
  component: function RequestDetailRoute() {
    const { id } = requestDetailRoute.useParams();
    const search = requestDetailRoute.useSearch();
    return <RequestDetailPage id={id} search={search} />;
  },
});

const inboxRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/inbox",
  component: InboxPage,
});

const policiesRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/policies",
  component: PoliciesPage,
});

const policyVersionsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/policies/$slug",
  component: function PolicyVersionsRoute() {
    const { slug } = policyVersionsRoute.useParams();
    return <PolicyVersionsPage slug={slug} />;
  },
});

const policyVersionRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/policy-versions/$id",
  component: function PolicyVersionRoute() {
    const { id } = policyVersionRoute.useParams();
    return <PolicyVersionPage id={id} />;
  },
});

const simulationsIndexRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/simulations",
  component: function SimulationsIndex() {
    return (
      <p className="py-16 text-center text-sm text-gray-400">
        No simulation selected — start one from a draft policy version.
      </p>
    );
  },
});

const simulationRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/simulations/$id",
  component: function SimulationRoute() {
    const { id } = simulationRoute.useParams();
    return <SimulationPage id={id} />;
  },
});

const orgRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/org",
  component: OrgPage,
});

const auditRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/audit",
  component: AuditPage,
});

const adminRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/admin",
  component: AdminPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  authedRoute.addChildren([
    indexRoute,
    requestsRoute,
    newRequestRoute,
    requestDetailRoute,
    inboxRoute,
    policiesRoute,
    policyVersionsRoute,
    policyVersionRoute,
    simulationsIndexRoute,
    simulationRoute,
    orgRoute,
    auditRoute,
    adminRoute,
  ]),
]);

export const router = createRouter({ routeTree });
