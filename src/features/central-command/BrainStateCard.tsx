/**
 * BrainStateCard, central-command overview panel.
 *
 * Renders a non-interactive snapshot of the federated brain's vital
 * signs: LC arousal mode, DA arousal level, dual-process gate share,
 * BG suppression counts, cerebellum mean error, and killswitch level.
 *
 * Server-Component-safe: no hooks, no client APIs.
 */

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type {
  ArousalMode,
  BrainStateSnapshot,
  KillswitchLevel,
} from "./types";

interface BrainStateCardProps {
  readonly snapshot: BrainStateSnapshot;
}

const MODE_VARIANT: Record<
  ArousalMode,
  "success" | "warning" | "error"
> = {
  exploit: "success",
  explore: "warning",
  hyperalert: "error",
};

const KILLSWITCH_VARIANT: Record<
  KillswitchLevel,
  "success" | "warning" | "error" | "neutral"
> = {
  off: "success",
  throttle: "warning",
  suspend: "error",
  halt: "error",
};

function formatPct(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function formatNumber(value: number, digits = 2): string {
  return value.toFixed(digits);
}

export function BrainStateCard({ snapshot }: BrainStateCardProps) {
  const { lc, da, dualProcessGate, basalGanglia, cerebellum, killswitch } =
    snapshot;

  return (
    <Card variant="elevated" aria-labelledby="brain-state-title">
      <CardHeader>
        <CardTitle id="brain-state-title">Brain state</CardTitle>
        <CardDescription>
          Live vitals across LC, DA, dual-process gate, BG, cerebellum,
          killswitch.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">LC arousal mode</dt>
            <dd className="mt-1">
              <Badge variant={MODE_VARIANT[lc.mode]}>{lc.mode}</Badge>
              <span className="ml-2 font-mono text-xs tabular-nums">
                {formatNumber(lc.arousalLevel)}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">DA arousal</dt>
            <dd className="mt-1 font-mono text-sm tabular-nums">
              {formatNumber(da.arousalLevel)}
              <span className="ml-2 text-xs text-muted-foreground">
                rpe {formatNumber(da.rpeMean, 3)}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">
              Dual-process gate, 24h
            </dt>
            <dd className="mt-1 font-mono text-sm tabular-nums">
              {dualProcessGate.last24hCalls}
              <span className="ml-2 text-xs text-muted-foreground">
                s1 {formatPct(dualProcessGate.system1Pct)} / s2{" "}
                {formatPct(dualProcessGate.system2Pct)}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">BG suppressions</dt>
            <dd className="mt-1 font-mono text-sm tabular-nums">
              {basalGanglia.suppressionsLast24h}
              <span className="ml-2 text-xs text-muted-foreground">
                +{basalGanglia.approvalsLast24h} approvals
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Cerebellum error</dt>
            <dd className="mt-1 font-mono text-sm tabular-nums">
              {formatNumber(cerebellum.meanError, 4)}
              <span className="ml-2 text-xs text-muted-foreground">
                {cerebellum.weightUpdatesLast24h} updates
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Killswitch</dt>
            <dd className="mt-1">
              <Badge variant={KILLSWITCH_VARIANT[killswitch.level]}>
                {killswitch.level}
              </Badge>
              {killswitch.scope ? (
                <span className="ml-2 text-xs text-muted-foreground">
                  {killswitch.scope}
                </span>
              ) : null}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
