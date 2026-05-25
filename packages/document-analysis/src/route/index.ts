/**
 * Routing layer. Maps doc-type + extracted entities to module/action targets.
 *
 * Decision rules are declared once below — see `ROUTING_MATRIX`. Each entry
 * describes the target module, the action, and the minimum extracted-field
 * set that must be present for the routing to apply.
 *
 * Confidence: a routing's confidence is the minimum confidence among its
 * required fields, multiplied by the doc-type confidence. Below
 * `THRESHOLDS.AUTO_APPLY_ROUTING` the routing is HITL-gated.
 *
 * Wave-3-int2 update: `dispatchDocumentViaUnified()` is the bridge into
 * the dispatch-router. The legacy `decideRouting()` is retained for the
 * orchestrator's existing persistence path; new code should prefer the
 * unified bridge so the brain/document loops share one dispatcher.
 */

import type { ExtractedField } from '../extract/entity-extractor.js';
import {
  THRESHOLDS,
  type DocType,
  type Routing,
  type TargetModule,
} from '../types.js';
import type {
  AcceptHandlerRegistry,
  ConversationCapture,
  DispatchDeps,
  ModuleUpdateProposal,
  PersonaContext,
  ResolvedEntity,
  ResolvedEntityType,
  RoutingMatrixRow,
  RoutingRulesLoader,
} from '@borjie/dispatch-router';
import { runDispatchPipeline } from '@borjie/dispatch-router';

export interface RoutingDecision {
  readonly targetModule: TargetModule;
  readonly targetAction: string;
  readonly hitlRequired: boolean;
  readonly status: Routing['status'];
  readonly reasoning: Record<string, unknown>;
}

interface RoutingRule {
  readonly module: TargetModule;
  readonly action: string;
  /** All these extraction keys must be present (high-signal). */
  readonly requiredKeys: ReadonlyArray<string>;
  /** Optional — boost when these are present. */
  readonly optionalKeys?: ReadonlyArray<string>;
}

const ROUTING_MATRIX: Readonly<Record<Exclude<DocType, 'unknown'>, ReadonlyArray<RoutingRule>>> = {
  lease_application: [
    {
      module: 'estate',
      action: 'create_lease_application',
      requiredKeys: ['applicant_name', 'requested_asset'],
      optionalKeys: ['applicant_phone', 'applicant_nida', 'requested_rent'],
    },
  ],
  lease_contract: [
    {
      module: 'estate',
      action: 'create_lease',
      requiredKeys: ['tenant_name', 'asset_reference', 'monthly_rent'],
      optionalKeys: ['lease_start_date', 'lease_end_date', 'landlord_name'],
    },
  ],
  payment_receipt: [
    {
      module: 'finance',
      action: 'post_receipt',
      requiredKeys: ['amount'],
      optionalKeys: ['gepg_reference', 'mpesa_reference', 'payer_name', 'payment_date'],
    },
  ],
  national_id: [
    {
      module: 'compliance',
      action: 'archive_id',
      requiredKeys: ['id_number'],
      optionalKeys: ['full_name', 'date_of_birth'],
    },
  ],
  condition_survey: [
    {
      module: 'estate',
      action: 'update_condition',
      requiredKeys: ['asset_reference'],
      optionalKeys: ['inspection_date', 'inspector_name'],
    },
  ],
  complaint_letter: [
    {
      module: 'crm',
      action: 'open_ticket',
      requiredKeys: ['complainant_name'],
      optionalKeys: ['complaint_topic', 'asset_reference'],
    },
  ],
  renewal_request: [
    {
      module: 'estate',
      action: 'create_renewal_request',
      requiredKeys: ['tenant_name', 'asset_reference'],
      optionalKeys: ['requested_renewal_date'],
    },
  ],
  termination_notice: [
    {
      module: 'legal',
      action: 'process_termination',
      requiredKeys: ['tenant_name', 'asset_reference'],
      optionalKeys: ['effective_date'],
    },
  ],
  vendor_invoice: [
    {
      module: 'finance',
      action: 'process_invoice',
      requiredKeys: ['vendor_name', 'amount'],
      optionalKeys: ['invoice_number'],
    },
  ],
};

export interface DecideRoutingInput {
  readonly docType: DocType;
  readonly docTypeConfidence: number;
  readonly extractions: ReadonlyArray<ExtractedField>;
}

export function decideRouting(input: DecideRoutingInput): ReadonlyArray<RoutingDecision> {
  if (input.docType === 'unknown') {
    return [
      {
        targetModule: 'crm',
        targetAction: 'open_ticket',
        hitlRequired: true,
        status: 'pending',
        reasoning: {
          docType: 'unknown',
          docTypeConfidence: input.docTypeConfidence,
          rationale: 'no_doc_type_match',
        },
      },
    ];
  }

  const rules = ROUTING_MATRIX[input.docType];
  if (!rules || rules.length === 0) return [];

  const byKey = new Map<string, ExtractedField>();
  for (const ex of input.extractions) {
    byKey.set(ex.key, ex);
  }

  const out: RoutingDecision[] = [];

  for (const rule of rules) {
    const missing = rule.requiredKeys.filter((k) => !byKey.has(k));
    const present = rule.requiredKeys.filter((k) => byKey.has(k));
    const presentOptional = (rule.optionalKeys ?? []).filter((k) => byKey.has(k));

    if (missing.length > 0) {
      // Required entity missing → still route, but HITL-gated, so an operator
      // can fill in the blanks.
      out.push({
        targetModule: rule.module,
        targetAction: rule.action,
        hitlRequired: true,
        status: 'pending',
        reasoning: {
          docType: input.docType,
          docTypeConfidence: input.docTypeConfidence,
          requiredKeysMissing: missing,
          requiredKeysPresent: present,
          optionalKeysPresent: presentOptional,
          rationale: 'required_entity_missing',
        },
      });
      continue;
    }

    const minRequired = Math.min(
      ...rule.requiredKeys.map((k) => byKey.get(k)?.confidence ?? 0),
    );
    const combined = minRequired * input.docTypeConfidence;
    const autoApply = combined >= THRESHOLDS.AUTO_APPLY_ROUTING;

    out.push({
      targetModule: rule.module,
      targetAction: rule.action,
      hitlRequired: !autoApply,
      status: 'pending',
      reasoning: {
        docType: input.docType,
        docTypeConfidence: input.docTypeConfidence,
        minRequiredFieldConfidence: minRequired,
        combinedConfidence: combined,
        autoApplyThreshold: THRESHOLDS.AUTO_APPLY_ROUTING,
        requiredKeysPresent: present,
        optionalKeysPresent: presentOptional,
        rationale: autoApply ? 'auto_apply' : 'low_combined_confidence',
      },
    });
  }

  return out;
}

/** Exposed for tests + diagnostics. */
export { ROUTING_MATRIX };

// ─── Wave-3-int2 — Bridge into the dispatch-router ────────────────────────

/**
 * Map a document's TargetModule → the dispatch-router's
 * `module_template_id` enum value used in PLATFORM_ROUTING_MATRIX.
 *
 * The document route layer historically uses lowercase module slugs
 * ("estate", "finance", ...) while the dispatch-router uses uppercase
 * platform module IDs ("ESTATE", "FINANCE", ...). The bridge upper-cases.
 */
function moduleSlugToTemplateId(slug: TargetModule): string {
  return slug.toUpperCase();
}

/**
 * Map an `ExtractedField` to a dispatch-router `ResolvedEntity`. Doc-layer
 * extractions already carry confidence + a resolved entity reference (the
 * orchestrator's `resolveEntities` step populates that); we map best-effort
 * here, defaulting to the raw extraction key as the canonical id when no
 * resolution exists.
 */
function extractionToResolvedEntity(
  field: ExtractedField,
  resolvedId: string | null,
): ResolvedEntity | null {
  const type = extractedKeyToEntityType(field.key);
  if (!type) return null;
  const raw =
    typeof field.value === 'string' ? field.value : String(field.value ?? '');
  return {
    type,
    canonical_id: resolvedId ?? `doc_extract:${field.key}`,
    raw_value: raw,
    confidence: field.confidence,
    source: resolvedId ? 'document_resolved' : 'document_unresolved',
  };
}

function extractedKeyToEntityType(key: string): ResolvedEntityType | null {
  // The classifier emits canonical-ish keys; map to the dispatch-router
  // entity-type enum. Unknown keys return null so they're dropped.
  if (key === 'applicant_name' || key === 'tenant_name' || key === 'complainant_name')
    return 'customer';
  if (key === 'payer_name') return 'customer';
  if (key === 'asset_reference' || key === 'requested_asset') return 'unit';
  if (key === 'amount' || key === 'monthly_rent' || key === 'requested_rent')
    return 'amount';
  if (key === 'gepg_reference' || key === 'mpesa_reference' || key === 'invoice_number')
    return 'invoice';
  if (key === 'inspection_date' || key === 'payment_date' || key === 'lease_start_date')
    return 'date';
  if (key === 'id_number') return 'tenant_user';
  return null;
}

/**
 * Bridge a document's extraction set into a `ConversationCapture` shape
 * the dispatch-router can consume. This unifies the document and chat
 * brain↔tab loops onto one dispatcher.
 *
 * The resulting capture has:
 *   - intent derived from doc type (`file_event` for receipts/IDs, else
 *     `propose_action`).
 *   - capture_confidence = doc-type confidence (matches the legacy logic).
 *   - entities = resolved extractions only (unresolved are dropped).
 */
export interface BuildCaptureFromDocumentInput {
  readonly tenantId: string;
  readonly documentId: string;
  readonly docType: DocType;
  readonly docTypeConfidence: number;
  readonly extractions: ReadonlyArray<ExtractedField>;
  readonly resolutionByExtractionKey: ReadonlyMap<string, string>;
  readonly persona: PersonaContext;
  readonly captureId?: string;
  readonly now?: () => Date;
}

export function buildCaptureFromDocument(
  input: BuildCaptureFromDocumentInput,
): ConversationCapture {
  const now = input.now?.() ?? new Date();
  const captureId = input.captureId ?? `doc_cap_${input.documentId}`;

  const entities: ResolvedEntity[] = [];
  for (const field of input.extractions) {
    if (field.extractionKind !== 'entity') continue;
    const resolvedId = input.resolutionByExtractionKey.get(field.key) ?? null;
    const entity = extractionToResolvedEntity(field, resolvedId);
    if (entity) entities.push(entity);
  }

  // Add a synthetic 'document' entity so DOCUMENTS-module rules fire.
  entities.push({
    type: 'document',
    canonical_id: input.documentId,
    raw_value: input.docType,
    confidence: input.docTypeConfidence,
    source: 'doc_self',
  });

  const intent = docTypeToIntent(input.docType);

  return {
    id: captureId,
    tenant_id: input.tenantId,
    thread_id: null,
    message_id: null,
    persona_id: input.persona.persona_id,
    user_id: null,
    user_text: `[document ${input.documentId}]`,
    assistant_text: `[classified ${input.docType}]`,
    decision_kind: 'answer',
    entities,
    intent,
    intent_confidence: input.docTypeConfidence,
    capture_confidence: input.docTypeConfidence,
    persona_trust: 0.9,
    tenant_trust: 0.85,
    attributes: {
      origin: 'document',
      doc_type: input.docType,
      document_id: input.documentId,
    },
    exchange_hash: `doc-${input.documentId}-${input.docType}`,
    latency_ms: 0,
    created_at: now.toISOString(),
  };
}

function docTypeToIntent(
  docType: DocType,
): 'request_info' | 'propose_action' | 'file_event' | 'ask_for_help' | 'ambiguous' {
  switch (docType) {
    case 'payment_receipt':
    case 'national_id':
    case 'condition_survey':
      return 'file_event';
    case 'lease_application':
    case 'lease_contract':
    case 'vendor_invoice':
    case 'renewal_request':
    case 'termination_notice':
      return 'propose_action';
    case 'complaint_letter':
      return 'ask_for_help';
    default:
      return 'ambiguous';
  }
}

/**
 * `dispatchDocumentViaUnified` — single bridge that runs a document
 * through the dispatch-router using the SAME `runDispatchPipeline` that
 * chat captures use. This eliminates the doc-side custom routing matrix
 * for new flows (the legacy `decideRouting` is retained for back-compat).
 *
 * Returns the proposals + the synthetic capture shape used for audit.
 */
export interface DispatchDocumentViaUnifiedInput
  extends BuildCaptureFromDocumentInput {
  readonly platformDefaultMatrix?: ReadonlyArray<RoutingMatrixRow>;
}

export interface DispatchDocumentViaUnifiedDeps extends DispatchDeps {
  readonly routingRules: RoutingRulesLoader;
  readonly handlerRegistry: AcceptHandlerRegistry;
}

export interface DispatchDocumentViaUnifiedResult {
  readonly proposals: ReadonlyArray<ModuleUpdateProposal>;
  readonly capture: ConversationCapture;
}

export async function dispatchDocumentViaUnified(
  input: DispatchDocumentViaUnifiedInput,
  deps: DispatchDocumentViaUnifiedDeps,
): Promise<DispatchDocumentViaUnifiedResult> {
  const capture = buildCaptureFromDocument(input);
  const pipelineInput = {
    tenant_id: input.tenantId,
    capture,
    persona: input.persona,
    ...(input.platformDefaultMatrix
      ? { platformDefaultMatrix: input.platformDefaultMatrix }
      : {}),
  };
  const result = await runDispatchPipeline(pipelineInput, deps);
  return { proposals: result.proposals, capture };
}

// Re-export helpers for tests.
export { moduleSlugToTemplateId, extractionToResolvedEntity, docTypeToIntent };
