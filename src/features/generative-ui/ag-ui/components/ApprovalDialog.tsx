"use client";

/**
 * 6. approval — HIL approval dialog with diff preview + 5-item
 *    challenge-and-response checklist (per R1's HIL pattern).
 *
 * Anti-pattern enforced: Approve button is DISABLED until every
 * checklist item is positively acknowledged. No bypass — destructive
 * actions must pass through every gate.
 */

import { useState, useMemo } from "react";

import type { AgUiUiPartByKind } from "../types";
import { Frame, GenUiError } from "./Frame";
import { ApprovalPartSchema } from "../schemas";

export type ApprovalDialogProps = AgUiUiPartByKind<"approval">;

function diffSummary(
  diff: Readonly<Record<string, unknown>>,
): ReadonlyArray<string> {
  const entries = Object.entries(diff);
  return entries.map(([key, value]) => {
    if (
      value &&
      typeof value === "object" &&
      "from" in (value as Record<string, unknown>) &&
      "to" in (value as Record<string, unknown>)
    ) {
      const v = value as { from: unknown; to: unknown };
      return `${key}: ${JSON.stringify(v.from)} → ${JSON.stringify(v.to)}`;
    }
    return `${key}: ${JSON.stringify(value)}`;
  });
}

export function ApprovalDialog(props: ApprovalDialogProps): JSX.Element {
  const parsed = ApprovalPartSchema.safeParse(props);

  const [acked, setAcked] = useState<
    readonly [boolean, boolean, boolean, boolean, boolean]
  >([false, false, false, false, false]);
  const [decision, setDecision] = useState<"pending" | "approved" | "rejected">(
    "pending",
  );

  const allAcked = useMemo(() => acked.every(Boolean), [acked]);
  const summary = useMemo(() => diffSummary(props.diff), [props.diff]);

  if (!parsed.success) {
    return (
      <GenUiError
        kind="approval"
        message={parsed.error.issues.map((i) => i.message).join("; ")}
      />
    );
  }

  function toggle(i: number): void {
    setAcked((prev) => {
      const next = [...prev] as [boolean, boolean, boolean, boolean, boolean];
      next[i] = !prev[i];
      return next;
    });
  }

  return (
    <Frame
      kind="approval"
      {...(props.title
        ? { title: props.title }
        : { title: `Approve: ${props.action}` })}
    >
      <div className="text-xs space-y-3">
        <div>
          <div className="font-medium text-foreground mb-1">Changes</div>
          <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
            {summary.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
            {summary.length === 0 ? <li>(no diff)</li> : null}
          </ul>
        </div>
        <div>
          <div className="font-medium text-foreground mb-1">
            Challenge-and-response checklist
          </div>
          <ul className="space-y-1">
            {props.checklist.map((item, i) => (
              <li key={i} className="flex items-start gap-2">
                <input
                  id={`approval-ck-${i}`}
                  type="checkbox"
                  checked={acked[i]}
                  onChange={() => toggle(i)}
                  disabled={decision !== "pending"}
                />
                <label htmlFor={`approval-ck-${i}`} className="cursor-pointer">
                  {item}
                </label>
              </li>
            ))}
          </ul>
        </div>
        {decision === "pending" ? (
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!allAcked}
              onClick={() => setDecision("approved")}
              className="rounded bg-primary px-3 py-1 font-medium text-primary-foreground disabled:opacity-40"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={() => setDecision("rejected")}
              className="rounded border border-border bg-surface px-3 py-1"
            >
              Reject
            </button>
          </div>
        ) : (
          <div
            className={
              decision === "approved" ? "text-green-600" : "text-red-600"
            }
          >
            {decision === "approved" ? "Approved" : "Rejected"}
          </div>
        )}
      </div>
    </Frame>
  );
}
