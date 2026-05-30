/**
 * Schema-registry shared types.
 *
 * The MD's dynamic-UI surface lets the owner extend a tab's columns
 * without a code change. When a junior detects a new field (e.g. from
 * an uploaded employee CSV), it files a `FieldProposal`. The owner
 * approves or rejects; on approval a `LiveField` materialises and the
 * UI starts rendering the new column.
 *
 * Tables (see 20260623_md_schema_registry.sql):
 *   - org_field_schemas → LiveField
 *   - field_proposals   → FieldProposal
 *   - field_values      → sparse column store (per-row dynamic values)
 *   - junior_runs       → tamper-evident junior audit log
 *
 * @module features/central-command/md/schema-registry/types
 */

import { z } from "zod";

export const FIELD_KINDS = [
  "string",
  "number",
  "money",
  "percent",
  "date",
  "id",
  "enum",
  "boolean",
] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

export const TABLE_KEYS = [
  "employees",
  "customers",
  "suppliers",
  "inventory",
  "finance",
  "leads",
  "products",
  "compliance",
] as const;
export type TableKey = (typeof TABLE_KEYS)[number];

export const PROPOSAL_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "superseded",
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const fieldProposalSchema = z.object({
  id: z.string().uuid().optional(),
  orgId: z.string().uuid(),
  tableKey: z.enum(TABLE_KEYS),
  fieldKey: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/, "snake_case identifier"),
  fieldLabel: z.string().min(1).max(120),
  fieldKind: z.enum(FIELD_KINDS),
  enumValues: z.array(z.string().min(1).max(80)).max(32).optional(),
  required: z.boolean().default(false),
  proposerKind: z.enum(["junior", "owner", "auto-populate"]),
  proposerId: z.string().min(1).max(120),
  rationale: z.string().min(8).max(2000),
  sampleValues: z.array(z.string().max(400)).max(8).optional(),
});

export type FieldProposalInput = z.input<typeof fieldProposalSchema>;
export type FieldProposal = z.output<typeof fieldProposalSchema> & {
  readonly id: string;
  readonly status: ProposalStatus;
  readonly approvedAt: string | null;
  readonly approvedBy: string | null;
  readonly rejectedAt: string | null;
  readonly rejectedBy: string | null;
  readonly rejectReason: string | null;
  readonly executed: boolean;
  readonly executedAt: string | null;
  readonly createdAt: string;
};

export interface LiveField {
  readonly id: string;
  readonly orgId: string;
  readonly tableKey: TableKey;
  readonly fieldKey: string;
  readonly fieldLabel: string;
  readonly fieldKind: FieldKind;
  readonly enumValues?: ReadonlyArray<string>;
  readonly required: boolean;
  readonly source: string;
  readonly originProposalId?: string | null;
  readonly createdAt: string;
}

export interface FieldValue {
  readonly orgId: string;
  readonly tableKey: TableKey;
  readonly rowId: string;
  readonly fieldKey: string;
  readonly value: string | number | boolean | null;
}
