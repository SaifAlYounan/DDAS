import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { api } from "../api/client";
import { orgTreeQuery, principalsQuery } from "../api/queries";
import type { OrgPosition, OrgTree, OrgUnit } from "../api/types";
import { ErrorNote, Loading, errorMessage } from "../components/Loading";
import { hasRole, useMe } from "../components/MeContext";
import { useToast } from "../components/Toast";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Dialog } from "../components/ui/Dialog";
import { Field, Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { EmptyRow, Table, Td } from "../components/ui/Table";
import { formatDate } from "../lib/format";

type FormKind = "unit" | "position" | "assignment" | "delegation";

function nowLocalInput(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toIso(local: string): string {
  return new Date(local).toISOString();
}

export function OrgPage() {
  const me = useMe();
  const isAdmin = hasRole(me, "admin");
  const tree = useQuery(orgTreeQuery);
  const principals = useQuery({ ...principalsQuery, enabled: isAdmin });
  const [form, setForm] = useState<FormKind | null>(null);

  const nameOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of principals.data ?? []) map.set(p.id, p.name);
    for (const pos of tree.data?.positions ?? [])
      for (const h of pos.holders) map.set(h.principalId, h.name);
    return (id: string) => map.get(id) ?? `${id.slice(0, 8)}…`;
  }, [principals.data, tree.data]);

  if (tree.isPending) return <Loading />;
  if (tree.isError) return <ErrorNote error={tree.error} />;
  const org = tree.data;

  const roots = org.units.filter((u) => u.parentId === null);
  const childrenOf = (id: string) => org.units.filter((u) => u.parentId === id);
  const positionsOf = (unitId: string) => org.positions.filter((p) => p.orgUnitId === unitId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight text-gray-900">Organization</h1>
        {isAdmin && (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setForm("unit")}>
              Add unit
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setForm("position")}>
              Add position
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setForm("assignment")}>
              Assign holder
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setForm("delegation")}>
              Add delegation
            </Button>
          </div>
        )}
      </div>

      <Card title="Org tree">
        {roots.length === 0 ? (
          <p className="text-sm text-gray-400">No org units yet.</p>
        ) : (
          <ul className="space-y-3">
            {roots.map((u) => (
              <UnitNode
                key={u.id}
                unit={u}
                childrenOf={childrenOf}
                positionsOf={positionsOf}
                depth={0}
              />
            ))}
          </ul>
        )}
      </Card>

      <Card title="Delegations">
        <Table head={["From", "To", "Max tier", "Scope", "Valid", "Reason", ""]}>
          {org.delegations.length === 0 && (
            <EmptyRow colSpan={7} message="No delegations." />
          )}
          {org.delegations.map((d) => (
            <tr key={d.id}>
              <Td>{nameOf(d.from)}</Td>
              <Td>{nameOf(d.to)}</Td>
              <Td>
                <Badge tone="indigo">Tier ≤ {d.maxTier}</Badge>
              </Td>
              <Td className="text-xs">
                {d.scopeUnitId
                  ? (org.units.find((u) => u.id === d.scopeUnitId)?.name ?? d.scopeUnitId)
                  : "any unit"}
              </Td>
              <Td className="text-xs text-gray-500">
                {formatDate(d.validFrom)} → {d.validTo ? formatDate(d.validTo) : "open"}
              </Td>
              <Td className="max-w-56 text-xs text-gray-600">{d.reason}</Td>
              <Td>{isAdmin && <RevokeDelegation id={d.id} />}</Td>
            </tr>
          ))}
        </Table>
      </Card>

      {isAdmin && form !== null && (
        <OrgFormDialog kind={form} org={org} onClose={() => setForm(null)} />
      )}
    </div>
  );
}

function UnitNode({
  unit,
  childrenOf,
  positionsOf,
  depth,
}: {
  unit: OrgUnit;
  childrenOf: (id: string) => OrgUnit[];
  positionsOf: (id: string) => OrgPosition[];
  depth: number;
}) {
  const positions = positionsOf(unit.id);
  const children = childrenOf(unit.id);
  return (
    <li style={{ marginLeft: depth * 20 }}>
      <div className="rounded-md border border-gray-200 bg-gray-50/60 px-3 py-2">
        <p className="text-sm font-semibold text-gray-900">{unit.name}</p>
        {positions.length > 0 && (
          <ul className="mt-1.5 space-y-1">
            {positions.map((pos) => (
              <li key={pos.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Badge tone="indigo">Tier {pos.authorityTier}</Badge>
                <span className="font-medium text-gray-800">{pos.title}</span>
                {pos.holders.length === 0 ? (
                  <Badge tone="amber">vacant</Badge>
                ) : (
                  pos.holders.map((h) => (
                    <span key={h.assignmentId} className="text-xs text-gray-500">
                      {h.name} ({formatDate(h.validFrom)} →{" "}
                      {h.validTo ? formatDate(h.validTo) : "open"})
                    </span>
                  ))
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {children.length > 0 && (
        <ul className="mt-2 space-y-2">
          {children.map((c) => (
            <UnitNode
              key={c.id}
              unit={c}
              childrenOf={childrenOf}
              positionsOf={positionsOf}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function RevokeDelegation({ id }: { id: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const revoke = useMutation({
    mutationFn: () => api.del<{ ok: boolean }>(`/org/delegations/${id}`),
    onSuccess: () => {
      toast.push("Delegation revoked", "success");
      void queryClient.invalidateQueries({ queryKey: ["org", "tree"] });
    },
    onError: (err) => toast.push(errorMessage(err), "error"),
  });
  return (
    <Button variant="ghost" size="sm" onClick={() => revoke.mutate()} disabled={revoke.isPending}>
      Revoke
    </Button>
  );
}

const FORM_TITLES: Record<FormKind, string> = {
  unit: "Add org unit",
  position: "Add position",
  assignment: "Assign position holder",
  delegation: "Add delegation",
};

function OrgFormDialog({
  kind,
  org,
  onClose,
}: {
  kind: FormKind;
  org: OrgTree;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const principals = useQuery(principalsQuery);

  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [title, setTitle] = useState("");
  const [tier, setTier] = useState("1");
  const [positionId, setPositionId] = useState("");
  const [principalId, setPrincipalId] = useState("");
  const [fromPrincipalId, setFromPrincipalId] = useState("");
  const [toPrincipalId, setToPrincipalId] = useState("");
  const [maxTier, setMaxTier] = useState("1");
  const [scopeUnitId, setScopeUnitId] = useState("");
  const [validFrom, setValidFrom] = useState(nowLocalInput());
  const [validTo, setValidTo] = useState("");
  const [reason, setReason] = useState("");

  const submit = useMutation({
    mutationFn: () => {
      switch (kind) {
        case "unit": {
          const body: Record<string, unknown> = { name: name.trim() };
          if (parentId) body["parentId"] = parentId;
          return api.post<{ id: string }>("/org/units", body);
        }
        case "position":
          return api.post<{ id: string }>("/org/positions", {
            orgUnitId: unitId,
            title: title.trim(),
            authorityTier: Number(tier),
          });
        case "assignment": {
          const body: Record<string, unknown> = {
            positionId,
            principalId,
            validFrom: toIso(validFrom),
          };
          if (validTo) body["validTo"] = toIso(validTo);
          return api.post<{ id: string }>("/org/position-assignments", body);
        }
        case "delegation": {
          const body: Record<string, unknown> = {
            fromPrincipalId,
            toPrincipalId,
            maxTier: Number(maxTier),
            validFrom: toIso(validFrom),
            reason: reason.trim(),
          };
          if (scopeUnitId) body["orgUnitScopeId"] = scopeUnitId;
          if (validTo) body["validTo"] = toIso(validTo);
          return api.post<{ id: string }>("/org/delegations", body);
        }
      }
    },
    onSuccess: () => {
      toast.push(`${FORM_TITLES[kind]} — done`, "success");
      void queryClient.invalidateQueries({ queryKey: ["org", "tree"] });
      onClose();
    },
    onError: (err) => toast.push(errorMessage(err), "error"),
  });

  const valid =
    kind === "unit"
      ? name.trim().length > 0
      : kind === "position"
        ? unitId.length > 0 && title.trim().length > 0 && Number(tier) >= 0
        : kind === "assignment"
          ? positionId.length > 0 && principalId.length > 0 && validFrom.length > 0
          : fromPrincipalId.length > 0 &&
            toPrincipalId.length > 0 &&
            reason.trim().length > 0 &&
            validFrom.length > 0;

  const unitOptions: ReactNode = org.units.map((u) => (
    <option key={u.id} value={u.id}>
      {u.name}
    </option>
  ));
  const principalOptions: ReactNode = (principals.data ?? []).map((p) => (
    <option key={p.id} value={p.id}>
      {p.name} ({p.kind})
    </option>
  ));

  return (
    <Dialog
      open
      onClose={onClose}
      title={FORM_TITLES[kind]}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => submit.mutate()} disabled={!valid || submit.isPending}>
            {submit.isPending ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {kind === "unit" && (
          <>
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Parent unit (optional)">
              <Select value={parentId} onChange={(e) => setParentId(e.target.value)}>
                <option value="">— root —</option>
                {unitOptions}
              </Select>
            </Field>
          </>
        )}

        {kind === "position" && (
          <>
            <Field label="Org unit">
              <Select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                <option value="" disabled>
                  Select a unit
                </option>
                {unitOptions}
              </Select>
            </Field>
            <Field label="Title">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="Authority tier">
              <Input type="number" min={0} value={tier} onChange={(e) => setTier(e.target.value)} />
            </Field>
          </>
        )}

        {kind === "assignment" && (
          <>
            <Field label="Position">
              <Select value={positionId} onChange={(e) => setPositionId(e.target.value)}>
                <option value="" disabled>
                  Select a position
                </option>
                {org.positions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title} (tier {p.authorityTier})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Principal">
              <Select value={principalId} onChange={(e) => setPrincipalId(e.target.value)}>
                <option value="" disabled>
                  Select a principal
                </option>
                {principalOptions}
              </Select>
            </Field>
            <Field label="Valid from">
              <Input
                type="datetime-local"
                value={validFrom}
                onChange={(e) => setValidFrom(e.target.value)}
              />
            </Field>
            <Field label="Valid to (optional)">
              <Input
                type="datetime-local"
                value={validTo}
                onChange={(e) => setValidTo(e.target.value)}
              />
            </Field>
          </>
        )}

        {kind === "delegation" && (
          <>
            <Field label="From (delegator)">
              <Select value={fromPrincipalId} onChange={(e) => setFromPrincipalId(e.target.value)}>
                <option value="" disabled>
                  Select a principal
                </option>
                {principalOptions}
              </Select>
            </Field>
            <Field label="To (delegate)">
              <Select value={toPrincipalId} onChange={(e) => setToPrincipalId(e.target.value)}>
                <option value="" disabled>
                  Select a principal
                </option>
                {principalOptions}
              </Select>
            </Field>
            <Field label="Max tier">
              <Input
                type="number"
                min={0}
                value={maxTier}
                onChange={(e) => setMaxTier(e.target.value)}
              />
            </Field>
            <Field label="Scope unit (optional)">
              <Select value={scopeUnitId} onChange={(e) => setScopeUnitId(e.target.value)}>
                <option value="">any unit</option>
                {unitOptions}
              </Select>
            </Field>
            <Field label="Valid from">
              <Input
                type="datetime-local"
                value={validFrom}
                onChange={(e) => setValidFrom(e.target.value)}
              />
            </Field>
            <Field label="Valid to (optional)">
              <Input
                type="datetime-local"
                value={validTo}
                onChange={(e) => setValidTo(e.target.value)}
              />
            </Field>
            <Field label="Reason" hint="Required — recorded in the audit trail.">
              <Input value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          </>
        )}
      </div>
    </Dialog>
  );
}
