/**
 * Multi-Modal Reasoning Orchestrator — unified intent-driven composition.
 *
 * Closes the gap between ReAct reasoning and generative UI composition
 * by introducing a pre-reasoning intent classification stage that signals
 * to the reasoning loop what UI shapes the answer should carry.
 *
 * Three stages:
 *   1. Intent classification (fast, <10ms): domain/entity/action + candidate shapes
 *   2. Goal reframing: system prompt adjusted to emit proof-carrying artifacts
 *   3. Answer assembly: text + data + confidence → multi-modal response
 *
 * @module kernel/orchestrator/multi-modal-composer
 */

/**
 * The UI shape a multi-modal answer proposes to carry (e.g. 'data_table',
 * 'bar_chart', 'timeline', 'org_chart', 'comparison'). Defined LOCALLY as an
 * open string brand — NOT imported from `@borjie/genui` — so the brain kernel
 * never depends on the UI layer. The brain emits a shape NAME; the surface-side
 * genui registry (`GENUI_KINDS`) is the single authority that validates +
 * renders it. This preserves the brain → (no UI) import direction of the
 * modular monolith (UI depends on brain, never the reverse).
 */
export type GenUICatalogType = string;

// ─────────────────────────────────────────────────────────────────────
// Types — the public contract
// ─────────────────────────────────────────────────────────────────────

export interface MultiModalIntent {
  /** Domain the intent operates in: 'payroll' | 'workforce' | 'assets' etc */
  readonly domain: string;

  /** Entity class: 'site' | 'employee' | 'shift' | 'asset' */
  readonly entity: string;

  /** User action: 'show' | 'compare' | 'forecast' | 'analyze' */
  readonly action: string;

  /**
   * Candidate UI shapes ranked by confidence. Reasoner MUST emit data
   * for the top shape(s) if reasoning is successful. Always includes
   * 'chat' as fallback (confidence=0.5 minimum).
   */
  readonly suggested_shapes: ReadonlyArray<{
    readonly kind: GenUICatalogType;
    readonly confidence: number; // [0, 1]
    readonly reason: string;
  }>;

  /** Confidence in the intent classification itself [0, 1] */
  readonly intent_confidence: number;

  /** Raw intent text extracted from user message */
  readonly raw_intent: string;
}

/**
 * Data artifact protocol: tools emit proof-carrying data with
 * back-pointers to their source tool results.
 */
export interface ToolResultArtifact {
  readonly kind: 'data';
  readonly columns: ReadonlyArray<{
    readonly name: string;
    readonly type: 'string' | 'number' | 'boolean' | 'date';
  }>;
  readonly rows: ReadonlyArray<Record<string, unknown>>;
  /** row_index → [evidence_id, ...] back-pointers */
  readonly row_evidence: Readonly<Record<number, ReadonlyArray<string>>>;
}

/**
 * The artifact shape emitted in a multi-modal response. One per
 * suggested_shape that succeeded reasoning + data binding.
 */
export interface ComposedArtifact {
  readonly id: string;
  readonly kind: GenUICatalogType;
  readonly title?: string;
  readonly description?: string;

  /** Proven data from the reasoning loop (tool results) */
  readonly data: Record<string, unknown>;

  /** Inferred or declared schema (column names / types) */
  readonly schema?: Record<string, unknown>;

  /** Vega-Lite spec (for chart kinds) */
  readonly spec?: Record<string, unknown>;

  /**
   * Evidence chain: tool_result.callId values that produced this artifact.
   * The Auditor uses this to verify artifact grounding.
   */
  readonly evidence_ids: ReadonlyArray<string>;

  /** Confidence in the artifact binding [0, 1] */
  readonly confidence: number;
}

// ─────────────────────────────────────────────────────────────────────
// Tier-0: Fast Intent Classifier
// ─────────────────────────────────────────────────────────────────────

/**
 * Domain/entity/action rules for fast classification. No embeddings.
 * Tuned for Borjie's mining domain; extensible to BossNyumba (RE).
 */
const INTENT_RULES: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly domain: string;
  readonly entity: string;
  readonly action: string;
  readonly shapes: ReadonlyArray<GenUICatalogType>;
}> = [
  // Payroll queries
  {
    pattern: /\b(show|list|display)\s+(payroll|salary|wage)/i,
    domain: 'payroll',
    entity: 'employee',
    action: 'show',
    shapes: ['data_table', 'bar_chart'],
  },
  {
    pattern: /payroll\s+by\s+(site|location|department)/i,
    domain: 'payroll',
    entity: 'site',
    action: 'group',
    shapes: ['data_table', 'bar_chart', 'pie_chart'],
  },
  // Workforce queries
  {
    pattern: /\b(show|list|count)\s+(workforce|staff|workers|employees)/i,
    domain: 'workforce',
    entity: 'employee',
    action: 'show',
    shapes: ['data_table', 'bar_chart'],
  },
  {
    pattern: /workforce\s+by\s+(site|department|role)/i,
    domain: 'workforce',
    entity: 'site',
    action: 'group',
    shapes: ['data_table', 'bar_chart', 'treemap'],
  },
  // Asset/inventory queries
  {
    pattern: /\b(show|list|inventory)\s+(assets?|equipment|machinery)/i,
    domain: 'assets',
    entity: 'asset',
    action: 'show',
    shapes: ['data_table', 'bar_chart'],
  },
  // Forecast queries
  {
    pattern: /(forecast|project|predict)\s+(payroll|revenue|demand)/i,
    domain: 'payroll',
    entity: 'forecast',
    action: 'forecast',
    shapes: ['line_chart', 'bar_chart'],
  },
  // Org chart / hierarchy
  {
    pattern: /\b(org|organization|structure|hierarchy|team)\b/i,
    domain: 'organization',
    entity: 'org_unit',
    action: 'visualize',
    shapes: ['org_chart'],
  },
  // Timeline / history
  {
    pattern: /\b(history|timeline|over time|throughout|since)\b/i,
    domain: 'timeline',
    entity: 'event',
    action: 'timeline',
    shapes: ['timeline', 'line_chart'],
  },
  // Comparison queries
  {
    pattern: /\b(compare|comparison|versus|vs|difference)\b/i,
    domain: 'analysis',
    entity: 'entity',
    action: 'compare',
    shapes: ['comparison', 'bar_chart'],
  },
];

/**
 * Fast, tier-0 multi-modal intent classifier. Rule-based, <1ms.
 * Returns null if no confident match; caller falls back to tier-1.
 */
export function classifyIntentTier0(userMessage: string): MultiModalIntent | null {
  for (const rule of INTENT_RULES) {
    if (rule.pattern.test(userMessage)) {
      return {
        domain: rule.domain,
        entity: rule.entity,
        action: rule.action,
        suggested_shapes: [
          ...rule.shapes.map((shape) => ({
            kind: shape,
            confidence: 0.8,
            reason: `rule-matched shape for ${rule.domain}/${rule.entity}`,
          })),
          {
            kind: 'chat' as GenUICatalogType,
            confidence: 0.5,
            reason: 'fallback: always include chat',
          },
        ],
        intent_confidence: 0.85,
        raw_intent: userMessage.slice(0, 100),
      };
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// System Prompt Modifier
// ─────────────────────────────────────────────────────────────────────

/**
 * Reframe the reasoning goal when multi-modal intent is detected.
 * Instructs the reasoning loop to emit proof-carrying artifacts.
 */
export function renderMultiModalGoal(intent: MultiModalIntent): string {
  const shapeList = intent.suggested_shapes
    .filter((s) => s.kind !== 'chat')
    .map((s) => `'${s.kind}'`)
    .join(', ');

  return [
    '### Multi-Modal Reasoning Goal',
    '',
    `You MUST answer the user's question in text AND emit proof-carrying data artifacts.`,
    '',
    `The user intent is: ${intent.raw_intent}`,
    `Domain: ${intent.domain} | Entity: ${intent.entity} | Action: ${intent.action}`,
    '',
    `Suggested visualization shapes: [${shapeList}]`,
    '',
    'For each shape:',
    '  1. Run the requisite tools to gather the data',
    '  2. PROVE every row/cell: emit tool_result with row_evidence back-pointers',
    '  3. The final answer MUST include both text explanation AND data artifacts',
    '',
    'Proof-carrying protocol:',
    '  - Every data cell must carry an evidence_id pointing to a tool_result.callId',
    '  - Emit artifacts with kind, data, schema, and evidence_ids array',
    '  - If shapes cannot be proven, fall back to chat only (safe default)',
    '',
    'Priority: correctness > comprehensiveness. Emit only shapes you can prove.',
    '',
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────
// Answer Assembly
// ─────────────────────────────────────────────────────────────────────

/**
 * Tool results collected during reasoning. The main-loop enriches these
 * with data: ToolResultArtifact when applicable.
 */
export interface ToolResultWithArtifact {
  readonly callId: string;
  readonly toolName: string;
  readonly kind: 'ok' | 'error';
  readonly message: string;
  readonly data?: ToolResultArtifact;
  readonly citations?: ReadonlyArray<{ readonly id: string; readonly source: string }>;
}

/**
 * Assemble the final multi-modal response by binding artifacts from
 * tool results. Called after reasoning completes, before response serialization.
 *
 * This is the concrete implementation of the assembly step.
 */
export function assembleMultiModalAnswer(args: {
  readonly intent: MultiModalIntent | null;
  readonly text: string;
  readonly toolResults: ReadonlyArray<ToolResultWithArtifact>;
  readonly confidence: number; // K-7: honesty verdict confidence
}): {
  readonly text: string;
  readonly artifacts: ReadonlyArray<ComposedArtifact>;
} {
  // If no multi-modal intent detected, return text-only (safe default).
  if (!args.intent || args.intent.suggested_shapes.length === 0) {
    return { text: args.text, artifacts: [] };
  }

  const artifacts: ComposedArtifact[] = [];

  // For each suggested shape (except 'chat'), try to bind a data artifact.
  for (const shape of args.intent.suggested_shapes) {
    if (shape.kind === 'chat') continue; // 'chat' is not a visual artifact

    // Find the most relevant tool result that has data matching this shape.
    const relevantResult = args.toolResults.find(
      (r) =>
        r.kind === 'ok' &&
        r.data &&
        // Heuristic: if the shape is a table-like kind and the data has rows, match it
        (shape.kind === 'data_table' ||
          shape.kind === 'bar_chart' ||
          shape.kind === 'line_chart' ||
          shape.kind === 'pie_chart') &&
        r.data.rows.length > 0,
    );

    if (!relevantResult || !relevantResult.data) {
      // No data for this shape; skip (don't emit an empty artifact).
      continue;
    }

    // Infer schema from data columns.
    const schema: Record<string, unknown> = {};
    for (const col of relevantResult.data.columns) {
      schema[col.name] = { type: col.type };
    }

    // Collect evidence_ids: the call ID that produced this result.
    const evidence_ids = [relevantResult.callId];

    // For simple table/chart kinds, use the data as-is. Vega spec
    // generation is deferred to the client (genui renderer).
    const artifact: ComposedArtifact = {
      id: `artifact:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      kind: shape.kind,
      title: `${args.intent.entity} ${args.intent.action}`,
      data: {
        columns: relevantResult.data.columns.map((c) => c.name),
        values: relevantResult.data.rows,
      },
      schema,
      evidence_ids,
      confidence: Math.min(shape.confidence, args.confidence),
    };

    artifacts.push(artifact);
  }

  return {
    text: args.text,
    artifacts,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Wiring Hooks
// ─────────────────────────────────────────────────────────────────────

/**
 * Integration point: call this at the START of main-loop.ts before
 * reasoning begins.
 *
 * Usage in main-loop:
 *
 *   const intent = classifyIntentTier0(input.userMessage);
 *   const systemGoal = intent
 *     ? renderMultiModalGoal(intent)
 *     : '';
 *   const system = assembleSystemPrompt({...}) + systemGoal;
 *   // ... continue reasoning with enhanced system prompt
 */
export function createMultiModalComposer() {
  return {
    classifyIntent: classifyIntentTier0,
    renderGoal: renderMultiModalGoal,
    assembleAnswer: assembleMultiModalAnswer,
  };
}
