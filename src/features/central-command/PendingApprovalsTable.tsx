/**
 * PendingApprovalsTable, four-eye queue.
 *
 * Lists pending sovereign actions awaiting a second approver, with the
 * age of the oldest pending request highlighted at the top.
 */

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { PendingApproval } from "./types";

interface PendingApprovalsTableProps {
  readonly approvals: ReadonlyArray<PendingApproval>;
}

function oldestAge(approvals: ReadonlyArray<PendingApproval>): number {
  if (approvals.length === 0) return 0;
  return approvals.reduce(
    (max, a) => (a.ageMinutes > max ? a.ageMinutes : max),
    0,
  );
}

export function PendingApprovalsTable({
  approvals,
}: PendingApprovalsTableProps) {
  const oldest = oldestAge(approvals);

  return (
    <Card variant="elevated" aria-labelledby="pending-approvals-title">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle id="pending-approvals-title">
              Pending approvals
            </CardTitle>
            <CardDescription>
              Four-eye queue, {approvals.length} waiting.
            </CardDescription>
          </div>
          {approvals.length > 0 ? (
            <Badge variant={oldest > 60 ? "error" : "warning"}>
              oldest {oldest}m
            </Badge>
          ) : (
            <Badge variant="success">clear</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {approvals.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No actions awaiting approval.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Pending sovereign approvals
              </caption>
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th scope="col" className="pb-2">
                    Action
                  </th>
                  <th scope="col" className="pb-2">
                    Initiator
                  </th>
                  <th scope="col" className="pb-2">
                    Rationale
                  </th>
                  <th scope="col" className="pb-2">
                    Age
                  </th>
                </tr>
              </thead>
              <tbody>
                {approvals.map((a) => (
                  <tr key={a.id} className="border-b last:border-0">
                    <td className="py-2 font-mono text-xs">{a.actionType}</td>
                    <td className="py-2 text-xs">{a.initiatorId}</td>
                    <td className="py-2 text-xs text-muted-foreground">
                      {a.rationale}
                    </td>
                    <td className="py-2 font-mono text-xs tabular-nums">
                      {a.ageMinutes}m
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
