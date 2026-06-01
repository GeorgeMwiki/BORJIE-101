/**
 * Local support-case row + enum types for the api-gateway.
 *
 * WHY LOCAL (not imported from `@borjie/database`)
 * ------------------------------------------------
 * The `@borjie/database` barrel re-exports `SupportCase` / `SupportCaseStatus`
 * / `SupportCaseSeverity` / `SupportCaseStep` in a shape TypeScript resolves as
 * a NAMESPACE at this consumption site, so using them as TYPES trips
 * `TS2709 (Cannot use namespace 'X' as a type)`. This is the SAME documented
 * barrel drift the action-executor `types.ts` works around for `DatabaseClient`
 * (via `ReturnType`) and the draft handlers sidestep by using raw SQL.
 *
 * Re-declaring the small, stable row + enum shapes here keeps the support-cases
 * service tsc-self-contained without depending on cross-package barrel-type
 * resolution. The Drizzle `supportCases` TABLE VALUE is still imported from the
 * barrel (a value import — unaffected by TS2709) for the query builders.
 *
 * These mirror packages/database/src/schemas/support-cases.schema.ts EXACTLY;
 * keep them in sync if that schema changes.
 */

/** open | diagnosing | awaiting_user | resolved | escalated (0164 CHECK). */
export type SupportCaseStatus =
  | 'open'
  | 'diagnosing'
  | 'awaiting_user'
  | 'resolved'
  | 'escalated';

/** low | medium | high | critical (0164 CHECK). */
export type SupportCaseSeverity = 'low' | 'medium' | 'high' | 'critical';

/** One row of the `steps` jsonb array. */
export interface SupportCaseStep {
  readonly label: string;
  readonly state: 'done' | 'remaining' | 'blocked';
  readonly note?: string;
}

/** A persisted `support_cases` row (the columns the service reads/writes). */
export interface SupportCase {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly threadId: string | null;
  readonly title: string;
  readonly category: string;
  readonly status: string;
  readonly severity: string;
  readonly summary: string | null;
  readonly rootCause: string | null;
  readonly steps: unknown;
  readonly evidenceIds: unknown;
  readonly resolution: string | null;
  readonly escalationRef: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly resolvedAt: Date | null;
}
