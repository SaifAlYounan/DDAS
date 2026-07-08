/** Shared react-query option factories — one place for keys and fetchers. */
import { queryOptions } from "@tanstack/react-query";
import { api } from "./client";
import type {
  AdminPrincipal,
  AdminSettings,
  ApprovalTask,
  ClassificationDetail,
  DocumentText,
  InboxItem,
  Me,
  OrgTree,
  PolicySummary,
  PolicyVersion,
  PolicyVersionDetail,
  RequestDetail,
  RequestSummary,
  SimulationRun,
} from "./types";

export const meQuery = queryOptions({
  queryKey: ["me"],
  queryFn: () => api.get<Me>("/auth/me"),
  retry: false,
  staleTime: 5 * 60_000,
});

export const requestsQuery = queryOptions({
  queryKey: ["requests"],
  queryFn: () => api.get<RequestSummary[]>("/requests"),
});

export const requestQuery = (id: string) =>
  queryOptions({
    queryKey: ["requests", id],
    queryFn: () => api.get<RequestDetail>(`/requests/${id}`),
  });

export const documentTextQuery = (id: string) =>
  queryOptions({
    queryKey: ["documents", id, "text"],
    queryFn: () => api.get<DocumentText>(`/documents/${id}/text`),
    staleTime: Infinity,
  });

export const classificationQuery = (id: string) =>
  queryOptions({
    queryKey: ["classifications", id],
    queryFn: () => api.get<ClassificationDetail>(`/classifications/${id}`),
  });

export const inboxQuery = queryOptions({
  queryKey: ["inbox"],
  queryFn: () => api.get<InboxItem[]>("/approvals/inbox"),
});

export const approvalTaskQuery = (id: string) =>
  queryOptions({
    queryKey: ["approval-tasks", id],
    queryFn: () => api.get<ApprovalTask>(`/approval-tasks/${id}`),
  });

export const policiesQuery = queryOptions({
  queryKey: ["policies"],
  queryFn: () => api.get<PolicySummary[]>("/policies"),
});

export const policyVersionsQuery = (slug: string) =>
  queryOptions({
    queryKey: ["policies", slug, "versions"],
    queryFn: () => api.get<PolicyVersion[]>(`/policies/${encodeURIComponent(slug)}/versions`),
  });

export const policyVersionQuery = (id: string) =>
  queryOptions({
    queryKey: ["policy-versions", id],
    queryFn: () => api.get<PolicyVersionDetail>(`/policy-versions/${id}`),
  });

export const simulationQuery = (id: string) =>
  queryOptions({
    queryKey: ["simulations", id],
    queryFn: () => api.get<SimulationRun>(`/simulations/${id}`),
  });

export const orgTreeQuery = queryOptions({
  queryKey: ["org", "tree"],
  queryFn: () => api.get<OrgTree>("/org/tree"),
});

export const principalsQuery = queryOptions({
  queryKey: ["admin", "principals"],
  queryFn: () => api.get<AdminPrincipal[]>("/admin/principals"),
});

export const settingsQuery = queryOptions({
  queryKey: ["admin", "settings"],
  queryFn: () => api.get<AdminSettings>("/admin/settings"),
});
