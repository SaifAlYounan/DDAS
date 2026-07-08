import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import { principalsQuery, settingsQuery } from "../api/queries";
import { ALL_ROLES, type AdminPrincipal, type AdminSettings, type Role } from "../api/types";
import { ErrorNote, Loading, errorMessage } from "../components/Loading";
import { useToast } from "../components/Toast";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Dialog } from "../components/ui/Dialog";
import { Field, Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { EmptyRow, Table, Td } from "../components/ui/Table";

export function AdminPage() {
  const principals = useQuery(principalsQuery);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AdminPrincipal | null>(null);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight text-gray-900">Administration</h1>
        <Button onClick={() => setCreateOpen(true)}>New principal</Button>
      </div>

      {principals.isPending && <Loading />}
      {principals.isError && <ErrorNote error={principals.error} />}
      {principals.isSuccess && (
        <Table head={["Name", "Kind", "Email", "Roles", "", ""]}>
          {principals.data.length === 0 && <EmptyRow colSpan={6} message="No principals." />}
          {principals.data.map((p) => (
            <tr key={p.id} className="hover:bg-gray-50">
              <Td className="font-medium text-gray-900">{p.name}</Td>
              <Td>
                <Badge tone={p.kind === "agent" ? "blue" : "gray"}>{p.kind}</Badge>
              </Td>
              <Td className="text-gray-500">{p.email ?? "—"}</Td>
              <Td>
                <span className="flex flex-wrap gap-1">
                  {p.roles.length === 0 && <span className="text-xs text-gray-400">none</span>}
                  {p.roles.map((r) => (
                    <Badge key={r} tone="indigo">
                      {r}
                    </Badge>
                  ))}
                </span>
              </Td>
              <Td>{p.disabled && <Badge tone="red">disabled</Badge>}</Td>
              <Td className="text-right">
                <Button variant="ghost" size="sm" onClick={() => setEditing(p)}>
                  Edit roles
                </Button>
              </Td>
            </tr>
          ))}
        </Table>
      )}

      <SlaSettings />

      {createOpen && (
        <CreatePrincipalDialog
          onClose={() => setCreateOpen(false)}
          principals={principals.data ?? []}
        />
      )}
      {editing && <RoleEditorDialog principal={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function RoleCheckboxes({
  roles,
  onToggle,
}: {
  roles: Role[];
  onToggle: (role: Role) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {ALL_ROLES.map((role) => (
        <label key={role} className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={roles.includes(role)}
            onChange={() => onToggle(role)}
            className="accent-indigo-600"
          />
          {role.replace(/_/g, " ")}
        </label>
      ))}
    </div>
  );
}

function CreatePrincipalDialog({
  onClose,
  principals,
}: {
  onClose: () => void;
  principals: AdminPrincipal[];
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<"human" | "agent">("human");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [owner, setOwner] = useState("");
  const [roles, setRoles] = useState<Role[]>([]);

  const toggle = (role: Role) =>
    setRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));

  const create = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { kind, name: name.trim(), roles };
      if (email.trim()) body["email"] = email.trim();
      if (password) body["password"] = password;
      if (kind === "agent" && owner) body["ownerPrincipalId"] = owner;
      return api.post<{ id: string }>("/admin/principals", body);
    },
    onSuccess: () => {
      toast.push("Principal created", "success");
      void queryClient.invalidateQueries({ queryKey: ["admin", "principals"] });
      onClose();
    },
    onError: (err) => toast.push(errorMessage(err), "error"),
  });

  const valid =
    name.trim().length > 0 &&
    (password.length === 0 || password.length >= 12) &&
    (kind !== "agent" || owner.length > 0);

  return (
    <Dialog
      open
      onClose={onClose}
      title="New principal"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => create.mutate()} disabled={!valid || create.isPending}>
            {create.isPending ? "Creating…" : "Create"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Kind">
          <Select value={kind} onChange={(e) => setKind(e.target.value as "human" | "agent")}>
            <option value="human">Human</option>
            <option value="agent">AI agent</option>
          </Select>
        </Field>
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Email (optional)">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" hint="Minimum 12 characters. Leave empty for principals that never log in.">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
        {kind === "agent" && (
          <Field label="Accountable owner" hint="Every agent needs an accountable human owner.">
            <Select value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="" disabled>
                Select the owning human
              </option>
              {principals
                .filter((p) => p.kind === "human")
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </Select>
          </Field>
        )}
        <Field label="Roles">
          <RoleCheckboxes roles={roles} onToggle={toggle} />
        </Field>
      </div>
    </Dialog>
  );
}

function RoleEditorDialog({
  principal,
  onClose,
}: {
  principal: AdminPrincipal;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [roles, setRoles] = useState<Role[]>(
    principal.roles.filter((r): r is Role => (ALL_ROLES as string[]).includes(r))
  );

  const toggle = (role: Role) =>
    setRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));

  const save = useMutation({
    mutationFn: () =>
      api.post<{ roles: string[] }>(`/admin/principals/${principal.id}/roles`, { roles }),
    onSuccess: () => {
      toast.push(`Roles updated for ${principal.name}`, "success");
      void queryClient.invalidateQueries({ queryKey: ["admin", "principals"] });
      onClose();
    },
    onError: (err) => toast.push(errorMessage(err), "error"),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Roles — ${principal.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save roles"}
          </Button>
        </>
      }
    >
      <RoleCheckboxes roles={roles} onToggle={toggle} />
    </Dialog>
  );
}

function SlaSettings() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const settings = useQuery(settingsQuery);
  const [rows, setRows] = useState<Array<{ tier: string; hours: string }>>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (settings.data && !dirty) {
      setRows(
        Object.entries(settings.data.slaHoursByTier)
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([tier, hours]) => ({ tier, hours: String(hours) }))
      );
    }
  }, [settings.data, dirty]);

  const save = useMutation({
    mutationFn: () => {
      const slaHoursByTier: Record<string, number> = {};
      for (const row of rows) {
        if (row.tier.trim().length === 0) continue;
        slaHoursByTier[row.tier.trim()] = Number(row.hours);
      }
      return api.put<AdminSettings>("/admin/settings", { slaHoursByTier });
    },
    onSuccess: () => {
      toast.push("SLA settings saved", "success");
      setDirty(false);
      void queryClient.invalidateQueries({ queryKey: ["admin", "settings"] });
    },
    onError: (err) => toast.push(errorMessage(err), "error"),
  });

  const valid = rows.every(
    (r) => r.tier.trim().length === 0 || (Number(r.hours) > 0 && !Number.isNaN(Number(r.hours)))
  );

  return (
    <Card
      title="Approval SLAs (hours per tier)"
      actions={
        <Button size="sm" onClick={() => save.mutate()} disabled={!valid || !dirty || save.isPending}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      }
    >
      {settings.isPending && <Loading />}
      {settings.isError && <ErrorNote error={settings.error} />}
      {settings.isSuccess && (
        <div className="space-y-2">
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-3">
              <span className="w-10 text-sm text-gray-500">Tier</span>
              <Input
                className="w-20"
                value={row.tier}
                onChange={(e) => {
                  setRows((prev) => prev.map((r, j) => (j === i ? { ...r, tier: e.target.value } : r)));
                  setDirty(true);
                }}
              />
              <Input
                className="w-28"
                type="number"
                min={0.1}
                step={0.5}
                value={row.hours}
                onChange={(e) => {
                  setRows((prev) => prev.map((r, j) => (j === i ? { ...r, hours: e.target.value } : r)));
                  setDirty(true);
                }}
              />
              <span className="text-sm text-gray-500">hours to decide before escalation</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setRows((prev) => prev.filter((_, j) => j !== i));
                  setDirty(true);
                }}
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setRows((prev) => [...prev, { tier: "", hours: "24" }]);
              setDirty(true);
            }}
          >
            Add tier
          </Button>
        </div>
      )}
    </Card>
  );
}
