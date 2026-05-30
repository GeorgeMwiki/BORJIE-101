/**
 * OutcomesPanel, last 24h outcome counts.
 *
 * Pure rendering of outcome counts (approve / reject / cancel / refund),
 * brain-call totals, and operator-override totals. No state, no I/O.
 */

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { OutcomeCounts } from "./types";

interface OutcomesPanelProps {
  readonly outcomes: OutcomeCounts;
}

interface StatRow {
  readonly label: string;
  readonly value: number;
}

export function OutcomesPanel({ outcomes }: OutcomesPanelProps) {
  const stats: ReadonlyArray<StatRow> = [
    { label: "Approve", value: outcomes.approve },
    { label: "Reject", value: outcomes.reject },
    { label: "Cancel", value: outcomes.cancel },
    { label: "Refund", value: outcomes.refund },
    { label: "Brain calls", value: outcomes.brainCalls },
    { label: "Operator overrides", value: outcomes.operatorOverrides },
  ];

  return (
    <Card variant="elevated" aria-labelledby="outcomes-title">
      <CardHeader>
        <CardTitle id="outcomes-title">Outcomes, last 24h</CardTitle>
        <CardDescription>
          Decision outcomes with brain-call counts and operator overrides.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-3 gap-3 md:grid-cols-6">
          {stats.map((stat) => (
            <div key={stat.label} className="rounded-md border p-3">
              <dt className="text-xs text-muted-foreground">{stat.label}</dt>
              <dd className="mt-1 font-mono text-lg font-semibold tabular-nums">
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
