"use client";

/**
 * Client console for the central-command learning page.
 *
 * Operator can: force-flush cerebellum weights to DB, reset dopamine
 * for a tenant, rotate a manifest version. All three are wrapped in
 * the sovereign action POST surface; this UI is a thin shell that
 * hits stubs until the corresponding actions are wired into the
 * registry.
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

interface LearningAction {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly endpoint: string;
  readonly payload: Record<string, string>;
}

const LEARNING_ACTIONS: ReadonlyArray<LearningAction> = [
  {
    id: "cerebellum-flush",
    label: "Flush cerebellum weights",
    description:
      "Force the in-memory weight buffer to persist to durable storage immediately.",
    endpoint: "/api/central-command/actions/consolidate",
    payload: {
      sessionId: "cerebellum-global",
      tenantId: "platform",
      reason: "Operator-triggered cerebellum flush",
    },
  },
  {
    id: "dopamine-reset",
    label: "Reset tenant dopamine",
    description:
      "Reset DA arousal level and RPE skew for a single tenant scope.",
    endpoint: "/api/central-command/actions/killswitch-override",
    payload: {
      level: "off",
      scope: "dopamine:tenant-placeholder",
      reason: "Operator-triggered dopamine reset",
    },
  },
  {
    id: "manifest-rotate",
    label: "Rotate manifest version",
    description:
      "Promote a new immutable manifest version to the active pin.",
    endpoint: "/api/central-command/actions/model-rotate",
    payload: {
      modelId: "manifest",
      fromVersion: "v-current",
      toVersion: "v-next",
      reason: "Operator-triggered manifest rotation",
    },
  },
];

interface LearningStatus {
  readonly state: "idle" | "running" | "success" | "error";
  readonly message?: string;
}

export function LearningConsole() {
  const [statuses, setStatuses] = useState<
    Readonly<Record<string, LearningStatus>>
  >({});

  async function invoke(action: LearningAction) {
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
        body: JSON.stringify(action.payload),
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
        [action.id]: { state: "success", message: `Approval: ${approvalId}` },
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
    <Card variant="elevated" aria-labelledby="learning-console-title">
      <CardHeader>
        <CardTitle id="learning-console-title">Learning controls</CardTitle>
        <CardDescription>
          Operator-level overrides on learning subsystems.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3" aria-label="Learning console actions">
          {LEARNING_ACTIONS.map((action) => {
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
                  {status.state !== "idle" ? (
                    <Badge
                      variant={
                        status.state === "success"
                          ? "success"
                          : status.state === "error"
                            ? "error"
                            : "info"
                      }
                      className="mt-2"
                    >
                      <span aria-live="polite">
                        {status.state}
                        {status.message ? `: ${status.message}` : ""}
                      </span>
                    </Badge>
                  ) : null}
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
