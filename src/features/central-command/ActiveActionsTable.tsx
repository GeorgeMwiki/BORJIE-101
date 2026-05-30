/**
 * ActiveActionsTable, autonomous actions currently in flight.
 *
 * Displays actions running under `act-autonomous` (or related autonomy
 * levels). When the autonomy module is not yet wired the API returns an
 * empty list and the table shows an empty placeholder rather than an
 * error.
 */

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ActiveAutonomousAction } from "./types";

interface ActiveActionsTableProps {
  readonly actions: ReadonlyArray<ActiveAutonomousAction>;
}

const STATUS_VARIANT: Record<
  ActiveAutonomousAction["status"],
  "info" | "warning" | "error"
> = {
  running: "info",
  settling: "warning",
  "rolling-back": "error",
};

export function ActiveActionsTable({ actions }: ActiveActionsTableProps) {
  return (
    <Card variant="elevated" aria-labelledby="active-actions-title">
      <CardHeader>
        <CardTitle id="active-actions-title">Active autonomous actions</CardTitle>
        <CardDescription>
          Actions currently executing under autonomy. {actions.length} in
          flight.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {actions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No autonomous actions in flight.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Active autonomous actions
              </caption>
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th scope="col" className="pb-2">
                    Action
                  </th>
                  <th scope="col" className="pb-2">
                    Tenant
                  </th>
                  <th scope="col" className="pb-2">
                    Autonomy
                  </th>
                  <th scope="col" className="pb-2">
                    Status
                  </th>
                  <th scope="col" className="pb-2">
                    Started
                  </th>
                </tr>
              </thead>
              <tbody>
                {actions.map((a) => (
                  <tr key={a.id} className="border-b last:border-0">
                    <td className="py-2 font-mono text-xs">{a.actionType}</td>
                    <td className="py-2 text-xs text-muted-foreground">
                      {a.tenantId ?? "platform"}
                    </td>
                    <td className="py-2 text-xs">{a.autonomyLevel}</td>
                    <td className="py-2">
                      <Badge variant={STATUS_VARIANT[a.status]}>
                        {a.status}
                      </Badge>
                    </td>
                    <td className="py-2 text-xs text-muted-foreground">
                      {new Date(a.startedAt).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
