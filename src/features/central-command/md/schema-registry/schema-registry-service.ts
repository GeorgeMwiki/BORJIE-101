/**
 * Schema-registry service — propose / approve / list dynamic fields.
 *
 * Backport-of-pattern from Borjie101 approval-policy.service +
 * one-shot consumption guard (migration 0145): once a proposal is
 * approved AND executed, `executed` flips to TRUE and a second
 * approve returns `already_executed`. The materialised live field
 * carries `originProposalId` so we can walk the chain from any row
 * back to who proposed it, who approved it, and when.
 *
 * The service is pure — it takes a Supabase-like client at construct
 * time and never reaches for env. The route layer composes it.
 *
 * @module features/central-command/md/schema-registry/schema-registry-service
 */

import { createLogger } from "@/lib/logger";

import {
  fieldProposalSchema,
  type FieldKind,
  type FieldProposal,
  type FieldProposalInput,
  type LiveField,
  type TableKey,
} from "./types";

const log = createLogger("md.schema-registry");

// ---------------------------------------------------------------------------
// Public ports
// ---------------------------------------------------------------------------

/** Minimal Supabase shape this service consumes. Same loose contract
 *  the rest of the MD slice uses so tests can stub it cleanly. */
export interface SchemaRegistrySupabaseLike {
  from(table: string): {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic external data shape; narrowing handled at call sites
    select(cols?: string): any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic external data shape; narrowing handled at call sites
    insert(rows: unknown): any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic external data shape; narrowing handled at call sites
    update(values: unknown): any;
  };
}

export interface ProposeFieldArgs {
  readonly proposal: FieldProposalInput;
}

export interface ApproveFieldArgs {
  /** C-1 fix: tenant-scope the lookup so a leaked proposalId from
   *  another org cannot be approved by an attacker who happens to
   *  have ORG_ADMIN on their own tenant. */
  readonly orgId: string;
  readonly proposalId: string;
  readonly approverUserId: string;
}

export interface RejectFieldArgs {
  /** C-1 fix: same tenancy scoping as approveField. */
  readonly orgId: string;
  readonly proposalId: string;
  readonly approverUserId: string;
  readonly reason: string;
}

export interface ProposeFieldResult {
  readonly ok: boolean;
  readonly proposalId?: string;
  readonly error?: string;
}

export interface ApproveFieldResult {
  readonly ok: boolean;
  readonly fieldId?: string;
  readonly proposalId: string;
  readonly alreadyExecuted?: boolean;
  readonly error?: string;
}

export interface SchemaRegistryService {
  /**
   * File a field proposal. Idempotent on (orgId, tableKey, fieldKey)
   * for pending proposals — a second propose for the same key reuses
   * the existing pending row rather than spawning a duplicate.
   */
  proposeField(args: ProposeFieldArgs): Promise<ProposeFieldResult>;
  /**
   * Approve a pending proposal and materialise the LiveField row.
   * Enforces the one-shot consumption guard: re-approving a previously
   * approved+executed proposal returns `alreadyExecuted: true`.
   */
  approveField(args: ApproveFieldArgs): Promise<ApproveFieldResult>;
  /** Reject a pending proposal with a reason for the audit trail. */
  rejectField(args: RejectFieldArgs): Promise<{ ok: boolean; error?: string }>;
  /** List pending proposals for an org. */
  listPending(orgId: string): Promise<ReadonlyArray<FieldProposal>>;
  /** List live fields the UI should render for a (org, tableKey). */
  listLiveFields(
    orgId: string,
    tableKey: TableKey,
  ): Promise<ReadonlyArray<LiveField>>;
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

export function makeSchemaRegistryService(
  supabase: SchemaRegistrySupabaseLike,
): SchemaRegistryService {
  return Object.freeze({
    async proposeField({
      proposal,
    }: ProposeFieldArgs): Promise<ProposeFieldResult> {
      const parsed = fieldProposalSchema.safeParse(proposal);
      if (!parsed.success) {
        log.warn("schema-registry.propose.invalid", {
          issues: parsed.error.issues,
        });
        return {
          ok: false,
          error: `invalid_proposal: ${parsed.error.issues
            .map((i) => i.message)
            .join(", ")}`,
        };
      }
      const p = parsed.data;

      // Idempotency: if an open pending proposal for the same field
      // already exists, return its id instead of spawning a duplicate.
      try {
        const existing = await supabase
          .from("field_proposals")
          .select("id, status")
          .eq("org_id", p.orgId)
          .eq("table_key", p.tableKey)
          .eq("field_key", p.fieldKey)
          .eq("status", "pending")
          .limit(1);
        const row =
          Array.isArray((existing as { data?: unknown[] }).data) &&
          ((existing as { data: unknown[] }).data[0] as
            | { id: string }
            | undefined);
        if (row && typeof row.id === "string") {
          return { ok: true, proposalId: row.id };
        }
      } catch {
        /* fall through to insert */
      }

      try {
        const inserted = await supabase.from("field_proposals").insert([
          {
            org_id: p.orgId,
            table_key: p.tableKey,
            field_key: p.fieldKey,
            field_label: p.fieldLabel,
            field_kind: p.fieldKind,
            enum_values: p.enumValues ?? null,
            required: p.required,
            proposer_kind: p.proposerKind,
            proposer_id: p.proposerId,
            rationale: p.rationale,
            sample_values: p.sampleValues ?? null,
            status: "pending",
          },
        ]);
        const result = inserted as {
          data?: ReadonlyArray<{ id: string }>;
          error?: { message: string } | null;
        };
        if (result.error) {
          return { ok: false, error: result.error.message };
        }
        const proposalId = result.data?.[0]?.id;
        return proposalId
          ? { ok: true, proposalId }
          : { ok: true, proposalId: undefined };
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : "insert_failed",
        };
      }
    },

    async approveField({
      orgId,
      proposalId,
      approverUserId,
    }: ApproveFieldArgs): Promise<ApproveFieldResult> {
      // Read the proposal first to check the one-shot guard + carry
      // the field shape into org_field_schemas. C-1: scoped by org_id
      // so an attacker's leaked proposalId from another tenant returns
      // not_found.
      interface ProposalRowShape {
        id: string;
        org_id: string;
        table_key: TableKey;
        field_key: string;
        field_label: string;
        field_kind: FieldKind;
        enum_values: unknown;
        required: boolean;
        proposer_kind: string;
        proposer_id: string;
        status: string;
        executed: boolean;
      }
      let proposalRow: ProposalRowShape | null = null;
      try {
        const r = await supabase
          .from("field_proposals")
          .select(
            "id, org_id, table_key, field_key, field_label, field_kind, enum_values, required, proposer_kind, proposer_id, status, executed",
          )
          .eq("id", proposalId)
          .eq("org_id", orgId) // C-1: tenant scope
          .limit(1);
        const data = (r as { data?: unknown[] }).data;
        proposalRow =
          Array.isArray(data) && data[0] ? (data[0] as ProposalRowShape) : null;
      } catch (e) {
        return {
          ok: false,
          proposalId,
          error: e instanceof Error ? e.message : "read_failed",
        };
      }
      if (!proposalRow) {
        return { ok: false, proposalId, error: "not_found" };
      }
      // Defence-in-depth: the org_id should already match because we
      // queried with it, but a buggy Supabase mock or future refactor
      // shouldn't silently allow a cross-tenant write.
      if (proposalRow.org_id !== orgId) {
        log.warn("schema-registry.approve.org-mismatch", {
          expected: orgId,
          actual: proposalRow.org_id,
          proposalId,
        });
        return { ok: false, proposalId, error: "org_mismatch" };
      }
      // M-7: a human proposer cannot approve their own proposal.
      // Juniors (`proposer_kind === "junior"`) are non-human and the
      // 4-eye gate is already satisfied at the role layer.
      if (
        proposalRow.proposer_kind === "owner" &&
        proposalRow.proposer_id === approverUserId
      ) {
        return {
          ok: false,
          proposalId,
          error: "self_approval_forbidden",
        };
      }
      if (proposalRow.executed) {
        return {
          ok: true,
          proposalId,
          alreadyExecuted: true,
        };
      }
      if (proposalRow.status === "rejected") {
        return { ok: false, proposalId, error: "already_rejected" };
      }

      // 1. Insert the LiveField row.
      let fieldId: string | undefined;
      try {
        const ins = await supabase.from("org_field_schemas").insert([
          {
            org_id: proposalRow.org_id,
            table_key: proposalRow.table_key,
            field_key: proposalRow.field_key,
            field_label: proposalRow.field_label,
            field_kind: proposalRow.field_kind,
            enum_values: proposalRow.enum_values,
            required: proposalRow.required,
            source:
              proposalRow.proposer_kind === "junior"
                ? `junior:${proposalRow.proposer_id}`
                : proposalRow.proposer_kind,
            origin_proposal_id: proposalRow.id,
            created_by: approverUserId,
          },
        ]);
        const r = ins as {
          data?: ReadonlyArray<{ id: string }>;
          error?: { message: string } | null;
        };
        if (r.error) {
          return { ok: false, proposalId, error: r.error.message };
        }
        fieldId = r.data?.[0]?.id;
      } catch (e) {
        return {
          ok: false,
          proposalId,
          error: e instanceof Error ? e.message : "insert_field_failed",
        };
      }

      // 2. Flip the proposal to approved + executed (one-shot guard).
      // Scoped by org_id for defence-in-depth (same as the read).
      try {
        const nowIso = new Date().toISOString();
        const upd = await supabase
          .from("field_proposals")
          .update({
            status: "approved",
            approved_at: nowIso,
            approved_by: approverUserId,
            executed: true,
            executed_at: nowIso,
          })
          .eq("id", proposalId)
          .eq("org_id", orgId); // C-1: tenant scope
        const r = upd as { error?: { message: string } | null };
        if (r.error) {
          log.warn("schema-registry.approve.update-failed", {
            proposalId,
            error: r.error.message,
          });
        }
      } catch (e) {
        log.warn("schema-registry.approve.update-threw", {
          proposalId,
          error: e instanceof Error ? e.message : String(e),
        });
      }

      return { ok: true, proposalId, fieldId };
    },

    async rejectField({
      orgId,
      proposalId,
      approverUserId,
      reason,
    }: RejectFieldArgs): Promise<{ ok: boolean; error?: string }> {
      try {
        const nowIso = new Date().toISOString();
        // C-1: tenant-scope the update so a leaked proposalId from
        // another tenant cannot be rejected by an attacker.
        const upd = await supabase
          .from("field_proposals")
          .update({
            status: "rejected",
            rejected_at: nowIso,
            rejected_by: approverUserId,
            reject_reason: reason.slice(0, 2000),
          })
          .eq("id", proposalId)
          .eq("org_id", orgId)
          .eq("status", "pending");
        const r = upd as { error?: { message: string } | null };
        if (r.error) {
          return { ok: false, error: r.error.message };
        }
        return { ok: true };
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : "reject_failed",
        };
      }
    },

    async listPending(orgId: string): Promise<ReadonlyArray<FieldProposal>> {
      try {
        const r = await supabase
          .from("field_proposals")
          .select("*")
          .eq("org_id", orgId)
          .eq("status", "pending")
          .order("created_at", { ascending: false })
          .limit(100);
        const data = (r as { data?: unknown[] }).data;
        return Array.isArray(data)
          ? data.map((row) => mapProposalRow(row as Record<string, unknown>))
          : [];
      } catch (e) {
        log.warn("schema-registry.listPending.failed", {
          orgId,
          error: e instanceof Error ? e.message : String(e),
        });
        return [];
      }
    },

    async listLiveFields(
      orgId: string,
      tableKey: TableKey,
    ): Promise<ReadonlyArray<LiveField>> {
      try {
        const r = await supabase
          .from("org_field_schemas")
          .select("*")
          .eq("org_id", orgId)
          .eq("table_key", tableKey)
          .is("archived_at", null)
          .limit(200);
        const data = (r as { data?: unknown[] }).data;
        return Array.isArray(data)
          ? data.map((row) => mapLiveFieldRow(row as Record<string, unknown>))
          : [];
      } catch (e) {
        log.warn("schema-registry.listLiveFields.failed", {
          orgId,
          tableKey,
          error: e instanceof Error ? e.message : String(e),
        });
        return [];
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function mapProposalRow(row: Record<string, unknown>): FieldProposal {
  return Object.freeze({
    id: String(row.id ?? ""),
    orgId: String(row.org_id ?? ""),
    tableKey: row.table_key as TableKey,
    fieldKey: String(row.field_key ?? ""),
    fieldLabel: String(row.field_label ?? ""),
    fieldKind: row.field_kind as FieldKind,
    enumValues: Array.isArray(row.enum_values)
      ? (row.enum_values as string[])
      : undefined,
    required: Boolean(row.required),
    proposerKind: row.proposer_kind as FieldProposal["proposerKind"],
    proposerId: String(row.proposer_id ?? ""),
    rationale: String(row.rationale ?? ""),
    sampleValues: Array.isArray(row.sample_values)
      ? (row.sample_values as string[])
      : undefined,
    status: (row.status ?? "pending") as FieldProposal["status"],
    approvedAt: (row.approved_at as string | null) ?? null,
    approvedBy: (row.approved_by as string | null) ?? null,
    rejectedAt: (row.rejected_at as string | null) ?? null,
    rejectedBy: (row.rejected_by as string | null) ?? null,
    rejectReason: (row.reject_reason as string | null) ?? null,
    executed: Boolean(row.executed),
    executedAt: (row.executed_at as string | null) ?? null,
    createdAt: String(row.created_at ?? ""),
  });
}

function mapLiveFieldRow(row: Record<string, unknown>): LiveField {
  return Object.freeze({
    id: String(row.id ?? ""),
    orgId: String(row.org_id ?? ""),
    tableKey: row.table_key as TableKey,
    fieldKey: String(row.field_key ?? ""),
    fieldLabel: String(row.field_label ?? ""),
    fieldKind: row.field_kind as FieldKind,
    enumValues: Array.isArray(row.enum_values)
      ? (row.enum_values as string[])
      : undefined,
    required: Boolean(row.required),
    source: String(row.source ?? "manual"),
    originProposalId: (row.origin_proposal_id as string | null) ?? null,
    createdAt: String(row.created_at ?? ""),
  });
}
