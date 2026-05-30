"use client";

/**
 * Client-only action console for central-command.
 *
 * Wraps the six action endpoints (drift-retrain, model-rotate,
 * skill-approve, killswitch-override, consolidate, replay) with a
 * shared form pattern. Each row carries the autonomy level + whether
 * a four-eye approval is required so operators can see the
 * governance posture before invoking.
 */

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCsrfHeaders } from "@/hooks/useCsrfToken";

interface ActionDef {
  readonly id: string;
  readonly label: string;
  readonly endpoint: string;
  readonly autonomyLevel: "act-autonomous" | "propose-only" | "shadow";
  readonly requiresApproval: boolean;
  readonly description: string;
  readonly samplePayload: Record<string, string>;
}

const ACTIONS: ReadonlyArray<ActionDef> = [
  {
    id: "drift-retrain",
    label: "Drift retrain",
    endpoint: "/api/central-command/actions/drift-retrain",
    autonomyLevel: "propose-only",
    requiresApproval: true,
    description: "Trigger targeted retrain for a model on a cohort.",
    samplePayload: {
      modelId: "credit-risk-v3",
      cohort: "tz-smallholder",
      reason: "RPE drift > 0.08 for 24h",
    },
  },
  {
    id: "model-rotate",
    label: "Rotate model",
    endpoint: "/api/central-command/actions/model-rotate",
    autonomyLevel: "propose-only",
    requiresApproval: true,
    description: "Pin traffic from one model version to another.",
    samplePayload: {
      modelId: "credit-risk",
      fromVersion: "v3",
      toVersion: "v4-rc",
      reason: "Promote winning challenger",
    },
  },
  {
    id: "skill-approve",
    label: "Approve / reject skill",
    endpoint: "/api/central-command/actions/skill-approve",
    autonomyLevel: "propose-only",
    requiresApproval: true,
    description: "Decide on a pending skill marketplace proposal.",
    samplePayload: {
      proposalId: "prop_abc123",
      decision: "approve",
      reason: "Coverage + safety review passed",
    },
  },
  {
    id: "killswitch-override",
    label: "Override killswitch",
    endpoint: "/api/central-command/actions/killswitch-override",
    autonomyLevel: "propose-only",
    requiresApproval: true,
    description: "Move the killswitch level for a scope.",
    samplePayload: {
      level: "throttle",
      scope: "credit-mind",
      reason: "Latency anomaly investigation underway",
    },
  },
  {
    id: "consolidate",
    label: "Force consolidate",
    endpoint: "/api/central-command/actions/consolidate",
    autonomyLevel: "act-autonomous",
    requiresApproval: false,
    description: "Flush a session's working memory to long-term store.",
    samplePayload: {
      sessionId: "sess_xyz",
      tenantId: "tenant_abc",
      reason: "End-of-pilot snapshot",
    },
  },
  {
    id: "replay",
    label: "Replay trace",
    endpoint: "/api/central-command/actions/replay",
    autonomyLevel: "shadow",
    requiresApproval: false,
    description: "Replay a specific decision trace by id.",
    samplePayload: {
      traceId: "trace_001",
      reason: "Regulator inquiry follow-up",
    },
  },
];

interface ActionStatus {
  readonly state: "idle" | "running" | "success" | "error";
  readonly message?: string;
}

const AUTONOMY_VARIANT: Record<
  ActionDef["autonomyLevel"],
  "success" | "warning" | "info"
> = {
  "act-autonomous": "success",
  "propose-only": "warning",
  shadow: "info",
};

export function ActionConsole() {
  const [statuses, setStatuses] = useState<Readonly<Record<string, ActionStatus>>>(
    {},
  );

  async function invoke(action: ActionDef) {
    setStatuses((prev) => ({
      ...prev,
      [action.id]: { state: "running" },
    }));
    try {
      const res = await fetch(action.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getCsrfHeaders(),
        },
        body: JSON.stringify(action.samplePayload),
      });
      const json: unknown = await res.json();
      if (!res.ok) {
        const message =
          typeof (json as { error?: string })?.error === "string"
            ? (json as { error: string }).error
            : `HTTP ${res.status}`;
        setStatuses((prev) => ({
          ...prev,
          [action.id]: { state: "error", message },
        }));
        return;
      }
      const approvalId =
        typeof (json as { approvalId?: string })?.approvalId === "string"
          ? (json as { approvalId: string }).approvalId
          : "queued";
      setStatuses((prev) => ({
        ...prev,
        [action.id]: {
          state: "success",
          message: `Approval id: ${approvalId}`,
        },
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "network_error";
      setStatuses((prev) => ({
        ...prev,
        [action.id]: { state: "error", message },
      }));
    }
  }

  return (
    <Card variant="elevated" aria-labelledby="action-console-title">
      <CardHeader>
        <CardTitle id="action-console-title">Action console</CardTitle>
        <CardDescription>
          Operator-level invocations. Each action routes through the
          sovereign-brain registry and the displayed governance posture
          applies.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3" aria-label="Available central-command actions">
          {ACTIONS.map((action) => {
            const status = statuses[action.id] ?? { state: "idle" as const };
            return (
              <li
                key={action.id}
                className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{action.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {action.description}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Badge variant={AUTONOMY_VARIANT[action.autonomyLevel]}>
                      {action.autonomyLevel}
                    </Badge>
                    <Badge
                      variant={action.requiresApproval ? "warning" : "success"}
                    >
                      {action.requiresApproval ? "4-eye" : "no approval"}
                    </Badge>
                    {status.state !== "idle" ? (
                      <span
                        className="text-xs"
                        aria-live="polite"
                        data-status={status.state}
                      >
                        {status.state}
                        {status.message ? `: ${status.message}` : ""}
                      </span>
                    ) : null}
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => invoke(action)}
                  disabled={status.state === "running"}
                  aria-label={`Invoke ${action.label}`}
                >
                  {status.state === "running" ? "Submitting" : "Invoke"}
                </Button>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
