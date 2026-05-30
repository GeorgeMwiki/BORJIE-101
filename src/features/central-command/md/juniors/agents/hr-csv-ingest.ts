/**
 * `hr-csv-ingest` — the HR-domain junior. Built on the shared
 * CSV-ingest factory so its security posture matches every other
 * domain junior.
 *
 * @module features/central-command/md/juniors/agents/hr-csv-ingest
 */

import { makeCsvIngestJunior } from "./csv-ingest-factory";

export const EMPLOYEES_STATIC_COLUMNS: ReadonlyArray<string> = Object.freeze([
  "id",
  "name",
  "email",
  "phone",
  "role",
  "department",
  "manager",
  "start_date",
  "end_date",
  "status",
  "branch",
  "national_id",
  "salary",
  "currency",
  "kra_pin",
]);

export const hrCsvIngestJunior = makeCsvIngestJunior({
  id: "hr-csv-ingest",
  label: "HR — CSV ingest",
  domain: "hr",
  tableKey: "employees",
  staticColumns: EMPLOYEES_STATIC_COLUMNS,
});

// Re-export the payload schema accessor for callers that still wired
// against the legacy export name.
export const hrCsvIngestPayloadSchema = hrCsvIngestJunior.payloadSchema;
export type HrCsvIngestPayload = {
  readonly tableKey: "employees";
  readonly csv: string;
  readonly source: string;
  readonly maxProposals?: number;
};
