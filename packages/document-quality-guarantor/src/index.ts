/**
 * @borjie/document-quality-guarantor — public barrel + factory.
 *
 *   createDocumentQualityGuarantor({
 *     intakeEngines, outputEngines,
 *     gates,
 *     queue, escalation, audit,
 *   })
 *
 * Returns a façade with:
 *   - processIntake(req)   → ExtractedDocument
 *   - processOutput(req)   → RenderedDocument
 *   - getEscalation(id)    → EscalationTicket | undefined
 *   - replayAudit(opId)    → OperationReplay
 *
 * The façade is the only thing the rest of the system imports. Each
 * subsystem is still exported individually for tests that want to
 * exercise one piece in isolation.
 */

export * from './types.js';

export {
  createInMemoryAuditChainStore,
  replayOperation,
  AUDIT_EVENT_KINDS,
  type AuditChainStore,
  type AuditEntry,
  type AuditEventKind,
  type OperationReplay,
} from './audit/index.js';

export {
  createFormatRegistry,
  BUILT_IN_HANDLERS,
  type FormatRegistry,
} from './format-coverage/index.js';

export {
  createIntakeOrchestrator,
  type IntakeOrchestrator,
  type IntakeOrchestratorDeps,
} from './intake/index.js';

export {
  createOutputOrchestrator,
  type OutputOrchestrator,
  type OutputOrchestratorDeps,
} from './output/index.js';

export {
  accessibilityGate,
  citationCoverageGate,
  composeGates,
  confidenceGate,
  fontEmbeddingGate,
  roundtripFidelityGate,
  schemaCompletenessGate,
  visualDiffGate,
  type AccessibilityGateInput,
  type CitationCoverageGateInput,
  type CitationCoverageGateOptions,
  type ComposedGateInput,
  type ComposeGatesOptions,
  type ConfidenceGateInput,
  type ConfidenceGateOptions,
  type FontEmbeddingGateInput,
  type Gate,
  type RoundtripFidelityGateInput,
  type RoundtripFidelityGateOptions,
  type SchemaCompletenessGateInput,
  type SchemaCompletenessGateOptions,
  type VisualDiffGateInput,
  type VisualDiffGateOptions,
} from './quality-gates/index.js';

export {
  createInMemoryRetryQueue,
  nextDelayMs,
  expectedSeries,
  type RetryQueue,
  type RetryQueueDeps,
  type EnqueueJobInput,
  type LeasedJob,
} from './retry-queue/index.js';

export {
  createEscalationService,
  type EscalateInput,
  type EscalationDeps,
  type EscalationService,
  type WorkflowEnginePort,
} from './escalation/index.js';

// ─────────────────────────────────────────────────────────────────────
// createDocumentQualityGuarantor — the assembled façade.
// ─────────────────────────────────────────────────────────────────────

import type { AuditChainStore, OperationReplay } from './audit/index.js';
import { replayOperation } from './audit/index.js';
import type { EscalationService } from './escalation/index.js';
import type { IntakeOrchestrator } from './intake/index.js';
import type { OutputOrchestrator } from './output/index.js';
import type { RetryQueue } from './retry-queue/index.js';
import type {
  EscalationTicket,
  EscalationTicketId,
  ExtractedDocument,
  IntakeRequest,
  OutputRequest,
  RenderedDocument,
  TenantId,
} from './types.js';

export interface DocumentQualityGuarantorDeps {
  readonly intake: IntakeOrchestrator;
  readonly output: OutputOrchestrator;
  readonly queue: RetryQueue;
  readonly escalation: EscalationService;
  readonly audit: AuditChainStore;
}

export interface DocumentQualityGuarantor {
  processIntake(req: IntakeRequest): Promise<ExtractedDocument>;
  processOutput(req: OutputRequest): Promise<RenderedDocument>;
  getEscalation(ticketId: EscalationTicketId): EscalationTicket | undefined;
  replayAudit(tenantId: TenantId, operationId: string): Promise<OperationReplay>;
}

export function createDocumentQualityGuarantor(
  deps: DocumentQualityGuarantorDeps,
): DocumentQualityGuarantor {
  return {
    processIntake: (req) => deps.intake.extract(req),
    processOutput: (req) => deps.output.render(req),
    getEscalation: (ticketId) => deps.escalation.getEscalation(ticketId),
    replayAudit: (tenantId, operationId) => replayOperation(deps.audit, tenantId, operationId),
  };
}
