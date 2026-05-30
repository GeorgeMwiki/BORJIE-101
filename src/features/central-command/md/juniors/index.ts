/**
 * Public barrel for the MD junior-agents subsystem.
 *
 * Consumers (the chat route, the proposal-approval route, tests) pull
 * from here so the internal shape can evolve without churning callers.
 *
 * @module features/central-command/md/juniors
 */

export * from "./types";
export { makeJuniorRegistry, juniorManifest } from "./registry";
export type { JuniorRegistry, JuniorManifestRow } from "./registry";
export {
  makeJuniorExecutor,
  __resetJuniorCooldownCacheForTests,
  __resetJuniorHashSecretForTests,
} from "./executor";
export type {
  JuniorExecutor,
  RunJuniorArgs,
  RunJuniorOutcome,
  JuniorExecutorDeps,
  JuniorExecutorSupabaseLike,
} from "./executor";
export {
  hrCsvIngestJunior,
  hrCsvIngestPayloadSchema,
  EMPLOYEES_STATIC_COLUMNS,
} from "./agents/hr-csv-ingest";
export type { HrCsvIngestPayload } from "./agents/hr-csv-ingest";
export { makeCsvIngestJunior } from "./agents/csv-ingest-factory";
export type { CsvIngestJuniorSpec } from "./agents/csv-ingest-factory";
export {
  customersCsvIngestJunior,
  suppliersCsvIngestJunior,
  inventoryCsvIngestJunior,
  financeCsvIngestJunior,
  leadsCsvIngestJunior,
  productsCsvIngestJunior,
  complianceCsvIngestJunior,
  ALL_DOMAIN_CSV_JUNIORS,
  CUSTOMERS_STATIC_COLUMNS,
  SUPPLIERS_STATIC_COLUMNS,
  INVENTORY_STATIC_COLUMNS,
  FINANCE_STATIC_COLUMNS,
  LEADS_STATIC_COLUMNS,
  PRODUCTS_STATIC_COLUMNS,
  COMPLIANCE_STATIC_COLUMNS,
} from "./agents/domain-juniors";
export { proposeJuniorSpawn } from "./planner";
export type { JuniorPlannerInput, JuniorSpawnProposal } from "./planner";
export {
  processObserverJunior,
  processMapperJunior,
  processDiagnoserJunior,
  processResearcherJunior,
  processRedesignerJunior,
  PROCESS_PIPELINE_JUNIORS,
} from "./agents/process-pipeline-juniors";
export { processAutomatorJunior } from "./agents/process-automator-junior";
export type { AutomatorPayload } from "./agents/process-automator-junior";
export { processVerifierJunior } from "./agents/process-verifier-junior";
export type { VerifierPayload } from "./agents/process-verifier-junior";
export type {
  ObserverPayload,
  MapperPayload,
  DiagnoserPayload,
  ResearcherPayload,
  RedesignerPayload,
  ProcessPipelineSupabaseLike,
} from "./agents/process-pipeline-juniors";

import { ALL_DOMAIN_CSV_JUNIORS } from "./agents/domain-juniors";
import { hrCsvIngestJunior } from "./agents/hr-csv-ingest";
import { PROCESS_PIPELINE_JUNIORS } from "./agents/process-pipeline-juniors";
import { processAutomatorJunior } from "./agents/process-automator-junior";
import { processVerifierJunior } from "./agents/process-verifier-junior";
import { makeJuniorRegistry } from "./registry";

/**
 * Default registry containing every shipped junior. The chat route
 * imports this; tests build their own registry with a subset.
 *
 * Order matters for the MD planner: HR first because employees is the
 * most common upload, then the rest in business-impact order, then
 * the process-pipeline juniors (which only fire under explicit
 * coordinator invocation, never from chat planner heuristics).
 */
export const defaultJuniorRegistry = makeJuniorRegistry([
  hrCsvIngestJunior,
  ...ALL_DOMAIN_CSV_JUNIORS,
  ...PROCESS_PIPELINE_JUNIORS,
  // Wave 8 — pipeline stages 7 + 9.
  processAutomatorJunior,
  processVerifierJunior,
]);
