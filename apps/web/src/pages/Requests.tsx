import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { requestsQuery } from "../api/queries";
import { ErrorNote, Loading } from "../components/Loading";
import { useMe, hasRole } from "../components/MeContext";
import { Badge, stateTone } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { EmptyRow, Table, Td } from "../components/ui/Table";
import { formatDate } from "../lib/format";

export function RequestsPage() {
  const me = useMe();
  const navigate = useNavigate();
  const requests = useQuery(requestsQuery);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight text-gray-900">Requests</h1>
        {hasRole(me, "requester") && (
          <Button onClick={() => void navigate({ to: "/requests/new" })}>New request</Button>
        )}
      </div>

      {requests.isPending && <Loading />}
      {requests.isError && <ErrorNote error={requests.error} />}
      {requests.isSuccess && (
        <Table head={["Title", "State", "Created"]}>
          {requests.data.length === 0 && (
            <EmptyRow colSpan={3} message="No requests yet." />
          )}
          {requests.data.map((r) => (
            <tr key={r.id} className="hover:bg-gray-50">
              <Td>
                <Link
                  to="/requests/$id"
                  params={{ id: r.id }}
                  className="font-medium text-indigo-600 hover:text-indigo-500"
                >
                  {r.title}
                </Link>
              </Td>
              <Td>
                <Badge tone={stateTone(r.state)}>{r.state.replace(/_/g, " ")}</Badge>
              </Td>
              <Td className="text-gray-500">{formatDate(r.createdAt)}</Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
