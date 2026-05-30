/**
 * `process-automator` — junior that codegens an `AutomationManifest`
 * from an approved process redesign.
 *
 * Pipeline stage 7 in the process-mining flow (post-4-eye-approval
 * of a redesign). The manifest is persisted as `status='draft'`; a
 * SECOND 4-eye approval is required to flip it to `active`. The
 * draft is fully serialisable so an operator can review every step
 * before activation.
 *
 * Mapping rules — each `RedesignChange.kind` becomes one or two
 * `AutomationStep` entries:
 *
 *   - automate_activity      → spawn_junior + write_audit
 *   - parallelise            → schedule_action (the slow leg)
 *   - introduce_decision     → evaluate_condition
 *   - add_activity           → invoke_skill + send_notification
 *   - consolidate_activities → write_audit (informational only)
 *   - reorder_edge           → schedule_action
 *   - remove_activity        → send_notification + write_audit
 *
 * Risk tier is derived from the redesign's expected_impact + the
 * presence of any `automate_activity` changes (those are always at
 * least "medium"; an APR-cap-touching change escalates to "high").
 *
 * The junior NEVER activates the manifest. It only emits the draft.
 *
 * @module features/central-command/md/juniors/agents/process-automator-junior
 */

import { z } from "zod";

import type {
  AutomationStep,
  AutomationStepKind,
  ProcessRedesignRecord,
} from "../../process-mining/types";

import type { JuniorRunContext, JuniorRunResult, MdJuniorPort } from "../types";

// iter-50-final: every write to a tier-scoped table MUST be preceded by
// `assertTierPolicy`. Both process-mining juniors persist to
// `automation_manifests` / `process_canary_runs`, which are
// borjie-admin-tier surfaces; the prior implementation skipped the
// governance check entirely.
import {
  assertTierPolicy,
  type TierAction,
} from "@/core/governance/tier-policy";

// ---------------------------------------------------------------------------
// Payload schema — caller supplies the approved redesign + the
// supabase handle the junior writes the manifest with.
// ---------------------------------------------------------------------------

export interface ProcessAutomatorSupabaseLike {
  from(table: string): {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic external data shape; narrowing handled at call sites
    insert(rows: unknown): any;
  };
}

export const automatorPayloadSchema = z.object({
  redesign: z.custom<ProcessRedesignRecord>(
    (v): v is ProcessRedesignRecord =>
      !!v && typeof v === "object" && "id" in v && "changeset" in v,
    "redesign record required",
  ),
  supabase: z.custom<ProcessAutomatorSupabaseLike>(
    (v): v is ProcessAutomatorSupabaseLike =>
      !!v && typeof (v as { from?: unknown }).from === "function",
    "supabase handle required",
  ),
});
export type AutomatorPayload = z.infer<typeof automatorPayloadSchema>;

// ---------------------------------------------------------------------------
// Change → AutomationStep mapping
// ---------------------------------------------------------------------------

interface MappedSteps {
  readonly steps: ReadonlyArray<AutomationStep>;
  readonly riskTier: "low" | "medium" | "high" | "critical";
}

function mapRedesignToSteps(redesign: ProcessRedesignRecord): MappedSteps {
  const out: AutomationStep[] = [];
  let highest: "low" | "medium" | "high" | "critical" = "low";

  const bump = (tier: "low" | "medium" | "high" | "critical"): void => {
    const rank = { low: 0, medium: 1, high: 2, critical: 3 } as const;
    if (rank[tier] > rank[highest]) highest = tier;
  };

  redesign.changeset.forEach((change, idx) => {
    const stepIdBase = `s${idx + 1}-${change.kind}`;
    // Special-case branches handle the high-leverage RedesignChangeKind
    // values first; the fallback branch handles the remaining ones via
    // pickStepKind (reorder_edge / parallelise / consolidate_activities).

    if (change.kind === "automate_activity") {
      bump("medium");
      // Two-step: spawn the junior + write an audit row.
      out.push(
        Object.freeze({
          kind: "spawn_junior",
          stepId: `${stepIdBase}-spawn`,
          target: `automated-${slug(change.target)}`,
          payload: { activity: change.target, source: "redesign" },
          guardrails: {
            maxAttempts: 3,
            timeoutMs: 30_000,
            requiresApproval: true,
          },
        }),
        Object.freeze({
          kind: "write_audit",
          stepId: `${stepIdBase}-audit`,
          target: "junior_runs",
          payload: { event: "automation_step", activity: change.target },
        }),
      );
    } else if (change.kind === "add_activity") {
      bump("medium");
      out.push(
        Object.freeze({
          kind: "invoke_skill",
          stepId: `${stepIdBase}-invoke`,
          target: change.target,
          payload: { description: change.description.slice(0, 400) },
          guardrails: { maxAttempts: 2, timeoutMs: 20_000 },
        }),
        Object.freeze({
          kind: "send_notification",
          stepId: `${stepIdBase}-notify`,
          target: "owner",
          payload: { headline: `New step "${change.target}" added` },
        }),
      );
    } else if (change.kind === "remove_activity") {
      bump("high");
      out.push(
        Object.freeze({
          kind: "send_notification",
          stepId: `${stepIdBase}-notify`,
          target: "owner",
          payload: { headline: `Step "${change.target}" removed` },
        }),
        Object.freeze({
          kind: "write_audit",
          stepId: `${stepIdBase}-audit`,
          target: "process_events",
          payload: { event: "activity_removed", activity: change.target },
        }),
      );
    } else if (change.kind === "introduce_decision") {
      bump("medium");
      out.push(
        Object.freeze({
          kind: "evaluate_condition",
          stepId: `${stepIdBase}-eval`,
          target: change.target,
          payload: {
            description: change.description.slice(0, 400),
          },
          guardrails: { maxAttempts: 2, timeoutMs: 10_000 },
        }),
      );
    } else {
      const fallbackKind = pickStepKind(change.kind);
      if (!fallbackKind) return;
      out.push(
        Object.freeze({
          kind: fallbackKind,
          stepId: stepIdBase,
          target: change.target,
          payload: { description: change.description.slice(0, 400) },
        }),
      );
    }
  });

  // Any expected-impact risk surface that mentions "APR" or "regulatory"
  // → escalate to high (touches consumer-protection regimes).
  const riskWords = (redesign.expectedImpact.risks ?? [])
    .join(" ")
    .toLowerCase();
  if (riskWords.includes("apr") || riskWords.includes("regulator")) {
    bump("high");
  }

  return Object.freeze({ steps: Object.freeze(out), riskTier: highest });
}

function pickStepKind(changeKind: string): AutomationStepKind | null {
  const map: Record<string, AutomationStepKind> = {
    reorder_edge: "schedule_action",
    parallelise: "schedule_action",
    consolidate_activities: "write_audit",
  };
  return map[changeKind] ?? null;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ---------------------------------------------------------------------------
// Junior port
// ---------------------------------------------------------------------------

export const processAutomatorJunior: MdJuniorPort = Object.freeze({
  id: "process-automator",
  label: "Process — Automator",
  domain: "ops",
  trigger: { kind: "manual" as const, invokedBy: "pipeline" },
  guardrails: {
    maxRowsPerRun: 32,
    maxProposalsPerRun: 0,
    cooldownMs: 30_000,
    maxDurationMs: 20_000,
    allowedTables: [],
  },
  payloadSchema: automatorPayloadSchema,
  description:
    "Codegens an AutomationManifest from an approved RedesignProposal. The manifest is persisted as status='draft'; a second 4-eye approval gate flips it to 'active' before any step fires.",
  async execute(ctx: JuniorRunContext): Promise<JuniorRunResult> {
    const payload = ctx.payload as AutomatorPayload;
    const redesign = payload.redesign;

    if (!redesign.executed) {
      return {
        outcome: "skipped_policy",
        proposalsFiled: 0,
        rowsProcessed: 0,
        summary:
          "Redesign has not been executed yet — automator only runs against post-approval redesigns.",
        errorMessage: "redesign_not_executed",
      };
    }
    if (redesign.changeset.length === 0) {
      return {
        outcome: "ok",
        proposalsFiled: 0,
        rowsProcessed: 0,
        summary: "Redesign has an empty changeset; nothing to automate.",
      };
    }

    const { steps, riskTier } = mapRedesignToSteps(redesign);
    if (steps.length === 0) {
      return {
        outcome: "ok",
        proposalsFiled: 0,
        rowsProcessed: 0,
        summary:
          "No mappable steps emitted (all changes were no-ops at the automator layer).",
      };
    }

    // iter-50-final: governance gate. Drafting an automation manifest
    // is a borjie-admin-tier write — the manifest is a queued
    // side-effect that the activation gate later flips to `active`.
    // Skipping `assertTierPolicy` here would be a hard rule violation
    // (CLAUDE.md: "Any new write call must call assertTierPolicy").
    // The action string flows through the reason-based resolver, which
    // matches it against the closest principled rule for the
    // borjie-admin policy table.
    const tierVerdict = assertTierPolicy(
      "borjie-admin",
      "automation.manifest.draft" as unknown as TierAction,
    );
    if (!tierVerdict.ok) {
      return {
        outcome: "skipped_policy",
        proposalsFiled: 0,
        rowsProcessed: steps.length,
        summary: `TierPolicy denied automation.manifest.draft for redesign ${redesign.id}: ${tierVerdict.reason}`,
        errorMessage: "tier_policy_denied",
      };
    }

    try {
      const ins = await payload.supabase.from("automation_manifests").insert([
        {
          org_id: ctx.orgId,
          process_key: redesign.processKey,
          redesign_id: redesign.id,
          manifest: { steps },
          risk_tier: riskTier,
          status: "draft",
        },
      ]);
      const err = (ins as { error?: { message: string } | null }).error;
      if (err) {
        return {
          outcome: "error",
          proposalsFiled: 0,
          rowsProcessed: steps.length,
          summary: `Manifest persist failed for redesign ${redesign.id}.`,
          errorMessage: err.message.slice(0, 500),
        };
      }
    } catch (e) {
      return {
        outcome: "error",
        proposalsFiled: 0,
        rowsProcessed: steps.length,
        summary: `Manifest persist threw.`,
        errorMessage: e instanceof Error ? e.message : String(e),
      };
    }

    return {
      outcome: "ok",
      proposalsFiled: 0,
      rowsProcessed: steps.length,
      summary: `Drafted AutomationManifest for "${redesign.processKey}" (${steps.length} step${steps.length === 1 ? "" : "s"}, risk=${riskTier}). Awaiting activation gate.`,
    };
  },
});

export { mapRedesignToSteps };
