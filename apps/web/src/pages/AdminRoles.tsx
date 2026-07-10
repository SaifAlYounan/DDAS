/**
 * Admin → Roles (ADR 0005): the six built-in roles listed read-only with
 * their permission sets visible, plus create/edit/delete of custom roles
 * over a permission-checkbox matrix. Assignment happens on the principal
 * page (Admin), alongside the built-in roles.
 *
 * The grantable catalog is derived from the built-in admin row — it holds
 * the FULL catalog — minus admin.* (never grantable to custom roles), so
 * the console never carries its own copy of the catalog.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";
import { rolesQuery } from "../api/queries";
import type { RoleDef } from "../api/types";
import { ErrorNote, Loading, errorMessage } from "../components/Loading";
import { useToast } from "../components/Toast";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { Field, Input } from "../components/ui/Input";
import { EmptyRow, Table, Td } from "../components/ui/Table";

function grantableCatalog(roles: RoleDef[]): string[] {
  const admin = roles.find((r) => r.id === "builtin:admin");
  return (admin?.permissions ?? []).filter((p) => !p.startsWith("admin.")).sort();
}

export function AdminRolesPage() {
  const roles = useQuery(rolesQuery);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<RoleDef | null>(null);

  const builtins = (roles.data ?? []).filter((r) => r.builtin);
  const custom = (roles.data ?? []).filter((r) => !r.builtin);
  const catalog = grantableCatalog(roles.data ?? []);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-gray-900">Roles</h1>
          <p className="mt-1 text-sm text-gray-500">
            Built-in roles are immutable permission sets. Custom roles compose the same
            permissions; grants are additive only, and admin permissions are never grantable.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>New custom role</Button>
      </div>

      {roles.isPending && <Loading />}
      {roles.isError && <ErrorNote error={roles.error} />}
      {roles.isSuccess && (
        <>
          <RoleTable
            title="Built-in roles"
            rows={builtins}
            empty="No built-in roles (this should never happen)."
          />
          <RoleTable
            title="Custom roles"
            rows={custom}
            empty="No custom roles yet — create one to slice the catalog differently."
            onEdit={setEditing}
          />
        </>
      )}

      {createOpen && (
        <RoleDialog catalog={catalog} onClose={() => setCreateOpen(false)} />
      )}
      {editing && (
        <RoleDialog catalog={catalog} role={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function RoleTable({
  title,
  rows,
  empty,
  onEdit,
}: {
  title: string;
  rows: RoleDef[];
  empty: string;
  onEdit?: (role: RoleDef) => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/admin/roles/${id}`),
    onSuccess: () => {
      toast.push("Custom role deleted", "success");
      void queryClient.invalidateQueries({ queryKey: ["admin", "roles"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "principals"] });
    },
    onError: (err) => toast.push(errorMessage(err), "error"),
  });

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      <Table head={["Name", "Description", "Permissions", "Members", ""]}>
        {rows.length === 0 && <EmptyRow colSpan={5} message={empty} />}
        {rows.map((role) => (
          <tr key={role.id} className="align-top hover:bg-gray-50">
            <Td className="font-medium text-gray-900 whitespace-nowrap">
              {role.name}
              {role.builtin && (
                <Badge tone="gray" className="ml-2">
                  built-in
                </Badge>
              )}
            </Td>
            <Td className="max-w-64 text-gray-500">{role.description ?? "—"}</Td>
            <Td>
              <span className="flex max-w-md flex-wrap gap-1">
                {role.permissions.length === 0 && (
                  <span className="text-xs text-gray-400">none</span>
                )}
                {role.permissions.map((permission) => (
                  <Badge key={permission} tone={permission.startsWith("admin.") ? "amber" : "indigo"}>
                    {permission}
                  </Badge>
                ))}
              </span>
            </Td>
            <Td>{role.members}</Td>
            <Td className="text-right whitespace-nowrap">
              {!role.builtin && onEdit && (
                <>
                  <Button variant="ghost" size="sm" onClick={() => onEdit(role)}>
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={role.members > 0 || remove.isPending}
                    title={role.members > 0 ? "Remove all members first" : undefined}
                    onClick={() => remove.mutate(role.id)}
                  >
                    Delete
                  </Button>
                </>
              )}
            </Td>
          </tr>
        ))}
      </Table>
    </section>
  );
}

/** Create (no `role`) or edit (`role` set) a custom role. */
function RoleDialog({
  catalog,
  role,
  onClose,
}: {
  catalog: string[];
  role?: RoleDef;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [permissions, setPermissions] = useState<string[]>(role?.permissions ?? []);

  const toggle = (permission: string) =>
    setPermissions((prev) =>
      prev.includes(permission) ? prev.filter((p) => p !== permission) : [...prev, permission]
    );

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        description: description.trim() || undefined,
        permissions,
      };
      return role
        ? api.put(`/admin/roles/${role.id}`, body)
        : api.post("/admin/roles", body);
    },
    onSuccess: () => {
      toast.push(role ? "Custom role updated" : "Custom role created", "success");
      void queryClient.invalidateQueries({ queryKey: ["admin", "roles"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "principals"] });
      onClose();
    },
    onError: (err) => toast.push(errorMessage(err), "error"),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={role ? `Edit role — ${role.name}` : "New custom role"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={name.trim().length === 0 || save.isPending}
          >
            {save.isPending ? "Saving…" : role ? "Save role" : "Create role"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description (optional)">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field
          label="Permissions"
          hint="Additive only — what is not checked is denied. Admin permissions cannot be granted to custom roles."
        >
          <div className="grid grid-cols-2 gap-2">
            {catalog.map((permission) => (
              <label
                key={permission}
                className="flex items-center gap-2 text-sm text-gray-700"
              >
                <input
                  type="checkbox"
                  checked={permissions.includes(permission)}
                  onChange={() => toggle(permission)}
                  className="accent-indigo-600"
                />
                <span className="font-mono text-xs">{permission}</span>
              </label>
            ))}
          </div>
        </Field>
      </div>
    </Dialog>
  );
}
