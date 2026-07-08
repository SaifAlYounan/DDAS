import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { policiesQuery, policyVersionsQuery } from "../api/queries";
import { ErrorNote, Loading } from "../components/Loading";
import { hasRole, useMe } from "../components/MeContext";
import { Badge, type BadgeTone } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { EmptyRow, Table, Td } from "../components/ui/Table";
import { PolicyDraftForm } from "../features/PolicyDraftForm";
import { formatDate, shortHash } from "../lib/format";

export const VERSION_TONE: Record<"draft" | "active" | "retired", BadgeTone> = {
  draft: "amber",
  active: "green",
  retired: "gray",
};

export function PoliciesPage() {
  const me = useMe();
  const navigate = useNavigate();
  const policies = useQuery(policiesQuery);
  const [newOpen, setNewOpen] = useState(false);
  const isAuthor = hasRole(me, "policy_author");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight text-gray-900">Policies</h1>
        {isAuthor && <Button onClick={() => setNewOpen(true)}>New policy</Button>}
      </div>

      {policies.isPending && <Loading />}
      {policies.isError && <ErrorNote error={policies.error} />}
      {policies.isSuccess && (
        <Table head={["Slug", "Active version", "Versions"]}>
          {policies.data.length === 0 && <EmptyRow colSpan={3} message="No policies yet." />}
          {policies.data.map((p) => (
            <tr key={p.id} className="hover:bg-gray-50">
              <Td>
                <Link
                  to="/policies/$slug"
                  params={{ slug: p.slug }}
                  className="font-medium text-indigo-600 hover:text-indigo-500"
                >
                  {p.slug}
                </Link>
              </Td>
              <Td>
                {p.activeVersion !== null ? (
                  <Badge tone="green">v{p.activeVersion}</Badge>
                ) : (
                  <Badge tone="gray">none active</Badge>
                )}
              </Td>
              <Td className="text-gray-500">{p.versions}</Td>
            </tr>
          ))}
        </Table>
      )}

      <Dialog open={newOpen} onClose={() => setNewOpen(false)} title="New policy draft" wide>
        <PolicyDraftForm
          onCreated={(_version, slug) => {
            setNewOpen(false);
            void navigate({ to: "/policies/$slug", params: { slug } });
          }}
        />
      </Dialog>
    </div>
  );
}

export function PolicyVersionsPage({ slug }: { slug: string }) {
  const me = useMe();
  const navigate = useNavigate();
  const versions = useQuery(policyVersionsQuery(slug));
  const [draftOpen, setDraftOpen] = useState(false);
  const isAuthor = hasRole(me, "policy_author");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-500">
            <Link to="/policies" className="text-indigo-600 hover:text-indigo-500">
              Policies
            </Link>{" "}
            /
          </p>
          <h1 className="text-xl font-semibold tracking-tight text-gray-900">{slug}</h1>
        </div>
        {isAuthor && <Button onClick={() => setDraftOpen(true)}>New draft</Button>}
      </div>

      {versions.isPending && <Loading />}
      {versions.isError && <ErrorNote error={versions.error} />}
      {versions.isSuccess && (
        <Table head={["Version", "Status", "Content hash", "Created", "Activated"]}>
          {versions.data.length === 0 && <EmptyRow colSpan={5} message="No versions yet." />}
          {[...versions.data]
            .sort((a, b) => b.version - a.version)
            .map((v) => (
              <tr key={v.id} className="hover:bg-gray-50">
                <Td>
                  <Link
                    to="/policy-versions/$id"
                    params={{ id: v.id }}
                    className="font-medium text-indigo-600 hover:text-indigo-500"
                  >
                    v{v.version}
                  </Link>
                </Td>
                <Td>
                  <Badge tone={VERSION_TONE[v.status]}>{v.status}</Badge>
                </Td>
                <Td className="font-mono text-xs text-gray-500">{shortHash(v.contentHash)}</Td>
                <Td className="text-gray-500">{formatDate(v.createdAt)}</Td>
                <Td className="text-gray-500">
                  {v.activatedAt ? formatDate(v.activatedAt) : "—"}
                </Td>
              </tr>
            ))}
        </Table>
      )}

      <Dialog
        open={draftOpen}
        onClose={() => setDraftOpen(false)}
        title={`New draft of ${slug}`}
        wide
      >
        <PolicyDraftForm
          fixedSlug={slug}
          onCreated={(version) => {
            setDraftOpen(false);
            void navigate({ to: "/policy-versions/$id", params: { id: version.id } });
          }}
        />
      </Dialog>
    </div>
  );
}
