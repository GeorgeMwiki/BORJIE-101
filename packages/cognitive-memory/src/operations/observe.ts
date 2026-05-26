/**
 * `memory.observe` operation (Wave 18AA).
 *
 * Record a new memory cell at `observed` status. Embedding is taken
 * from the embedding service (cached + budget-gated). An audit row
 * is appended to the tenant chain so every learning is provably
 * traceable. Spec §3.
 *
 * Pure-but-wired: the operation depends on three ports (cell repo,
 * embedding service, audit chain) so the same code runs against
 * Postgres in production and in-memory in tests.
 */

import {
  CognitiveMemoryError,
  observeInputSchema,
  type CellRepository,
  type CognitiveMemoryCell,
  type EmbeddingService,
  type AuditChainPort,
  type MemoryWriteContext,
  type ObserveInput,
  type SpanCitation,
} from '../types.js';

export interface ObserveDeps {
  readonly cells: CellRepository;
  readonly embedder: EmbeddingService;
  readonly audit: AuditChainPort;
  readonly id: () => string;
  readonly now?: () => string;
}

export function createObserve(deps: ObserveDeps) {
  const now: () => string = deps.now ?? ((): string => new Date().toISOString());
  return async function observe(
    input: ObserveInput,
    ctx: MemoryWriteContext,
  ): Promise<CognitiveMemoryCell> {
    // Validate input via zod — the API boundary is the place to catch
    // untyped junk. Internal callers benefit from the same guard.
    const parsed = observeInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new CognitiveMemoryError(
        'observe.invalid_input',
        'memory.observe: invalid input',
        { issues: parsed.error.issues },
      );
    }
    if (ctx.tenant_id.length === 0 || ctx.scope_id.length === 0) {
      throw new CognitiveMemoryError(
        'observe.invalid_context',
        'memory.observe: tenant_id and scope_id are required',
      );
    }
    const occurred_at: string = ctx.now ?? now();
    const embedding = await deps.embedder.embed(input.content_text);
    const id = deps.id();
    const citations: ReadonlyArray<SpanCitation> = input.evidence_citations ?? [];
    const audit_hash = await deps.audit.append({
      tenant_id: ctx.tenant_id,
      event_kind: 'memory.observe',
      cell_id: id,
      specialisation: ctx.specialisation,
      turn_id: ctx.turn_id,
      occurred_at,
      extra: {
        kind: input.kind,
        scope_id: ctx.scope_id,
        content_preview: input.content_text.slice(0, 120),
      },
    });
    const cell: CognitiveMemoryCell = {
      id,
      tenant_id: ctx.tenant_id,
      scope_id: ctx.scope_id,
      content: {
        text: input.content_text,
        embedding,
        structured: input.content_structured ?? {},
      },
      kind: input.kind,
      contributed_by_specialisation: ctx.specialisation,
      reinforced_by_specialisations: [],
      contributed_in_turn_id: ctx.turn_id,
      reinforced_in_turn_ids: [],
      evidence_citations: citations,
      confidence_score: input.initial_confidence ?? 0.5,
      access_count: 0,
      last_accessed_at: null,
      created_at: occurred_at,
      promoted_at: null,
      decayed_at: null,
      promotion_status: 'observed',
      contradicting_cell_id: null,
      audit_hash,
    };
    return deps.cells.insert(cell);
  };
}

export type ObserveFn = ReturnType<typeof createObserve>;
