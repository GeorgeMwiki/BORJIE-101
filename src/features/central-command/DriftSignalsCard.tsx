/**
 * DriftSignalsCard, three drift sources at a glance.
 *
 * Surfaces drift-detector, persona-drift, and alignment-faking-probe
 * signals so operators can see when downstream behaviour is diverging
 * from the calibrated baseline.
 */

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { DriftSignal } from "./types";

interface DriftSignalsCardProps {
  readonly signals: ReadonlyArray<DriftSignal>;
}

const SEVERITY_VARIANT: Record<
  DriftSignal["severity"],
  "success" | "warning" | "error"
> = {
  low: "success",
  medium: "warning",
  high: "error",
  critical: "error",
};

export function DriftSignalsCard({ signals }: DriftSignalsCardProps) {
  return (
    <Card variant="elevated" aria-labelledby="drift-signals-title">
      <CardHeader>
        <CardTitle id="drift-signals-title">Drift signals</CardTitle>
        <CardDescription>
          Drift-detector, persona-drift, alignment-faking probe.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {signals.length === 0 ? (
          <p className="text-sm text-muted-foreground">No drift signals.</p>
        ) : (
          <ul className="space-y-2" aria-label="Drift signals">
            {signals.map((s) => (
              <li
                key={`${s.source}-${s.observedAt}`}
                className="flex items-center gap-3 rounded-md border p-3"
              >
                <Badge variant={SEVERITY_VARIANT[s.severity]}>
                  {s.severity}
                </Badge>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{s.source}</p>
                  <p className="text-xs text-muted-foreground">{s.note}</p>
                </div>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {s.value.toFixed(3)} / {s.threshold.toFixed(3)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
