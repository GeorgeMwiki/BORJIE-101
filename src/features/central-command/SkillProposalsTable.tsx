/**
 * SkillProposalsTable, pending skill-marketplace proposals.
 *
 * Read-only listing of skill proposals from the OpenClaw marketplace
 * awaiting governance review. Operators move on proposals from the
 * dedicated actions page (not from here).
 */

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { SkillProposal } from "./types";

interface SkillProposalsTableProps {
  readonly proposals: ReadonlyArray<SkillProposal>;
}

const STATUS_VARIANT: Record<
  SkillProposal["status"],
  "warning" | "success" | "error"
> = {
  pending: "warning",
  approved: "success",
  rejected: "error",
};

export function SkillProposalsTable({ proposals }: SkillProposalsTableProps) {
  return (
    <Card variant="elevated" aria-labelledby="skill-proposals-title">
      <CardHeader>
        <CardTitle id="skill-proposals-title">Skill proposals</CardTitle>
        <CardDescription>
          OpenClaw marketplace queue, {proposals.length} pending review.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {proposals.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No skill proposals awaiting review.
          </p>
        ) : (
          <ul className="space-y-3" aria-label="Pending skill proposals">
            {proposals.map((p) => (
              <li
                key={p.id}
                className="flex items-start gap-3 rounded-md border p-3"
              >
                <Badge variant={STATUS_VARIANT[p.status]}>{p.status}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{p.skillName}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.summary}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Submitted by {p.authorId} on{" "}
                    {new Date(p.submittedAt).toLocaleDateString()}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
