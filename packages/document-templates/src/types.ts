/**
 * Document Composition — public contracts.
 *
 * Mirrors `docs/DESIGN/DOCUMENT_COMPOSITION_SPEC.md`. The 11 closed-set
 * document classes are encoded as a discriminated string union; new
 * classes require an enum extension AND a passing recipe-smoke test.
 *
 * All types are immutable (`readonly` everywhere) per coding-style.md.
 */

// ---------------------------------------------------------------------------
// Closed-set document classes — the 11 BORJIE recipes.
// ---------------------------------------------------------------------------

export type DocumentClass =
  | 'daily_briefing'
  | 'board_report'
  | 'investor_briefing'
  | 'tumemadini_return'
  | 'nemc_filing'
  | 'buyer_kyb_pack'
  | 'sop'
  | 'financial_model'
  | 'contract'
  | 'geological_report'
  | 'marketplace_listing';

export type DocumentFormat = 'pdf' | 'docx' | 'pptx' | 'xlsx' | 'md' | 'html';

export type RecipeStatus = 'draft' | 'shadow' | 'live' | 'locked' | 'deprecated';

/**
 * Authority tier per the Master Brain manifesto.
 *  - 0 = Read/Research only (no doc class lives here in v1)
 *  - 1 = Draft/Stage (autonomous; may auto-publish to internal channels)
 *  - 2 = Execute (requires explicit owner approval before send)
 */
export type AuthorityTier = 0 | 1 | 2;

export type ApprovalState = 'pending' | 'approved' | 'rejected' | 'auto_published';

// ---------------------------------------------------------------------------
// Span citation — shape matches `@borjie/ai-copilot/retrieval/Citation`
// but loosened to allow recipes to carry citations whose source is a
// research-result id, a regulator clause id, or a ledger row id — not
// just a chunk offset.
// ---------------------------------------------------------------------------

export interface SpanCitation {
  readonly id: string;
  readonly claim: string;
  readonly source: {
    readonly kind:
      | 'corpus_chunk'
      | 'research_result'
      | 'ledger'
      | 'measurement'
      | 'statute'
      | 'assay_cert'
      | 'external';
    readonly ref: string;
    readonly url?: string;
  };
  /** Optional character span inside the source chunk. */
  readonly span?: {
    readonly startOffset: number;
    readonly endOffset: number;
    readonly quotedSpan: string;
  };
}

// ---------------------------------------------------------------------------
// Input + citation contracts (recipe-declared requirements).
// ---------------------------------------------------------------------------

export interface InputContract {
  readonly key: string;
  readonly description: string;
  /** When true the composer short-circuits with INPUT_GAP if absent. */
  readonly required: boolean;
}

export interface CitationContract {
  readonly key: string;
  readonly description: string;
  /** Minimum citation count to satisfy this contract. */
  readonly minCount: number;
}

// ---------------------------------------------------------------------------
// Compose context — what the dispatcher hands the recipe.
// ---------------------------------------------------------------------------

export interface OwnerProfile {
  readonly id: string;
  readonly displayName: string;
  readonly preferred_language: 'en' | 'sw';
}

export interface DataJoin {
  readonly key: string;
  readonly value: unknown;
}

export type MasteryTier = 'novice' | 'fluent' | 'veteran';

export type TargetAudience = 'owner' | 'regulator' | 'investor' | 'buyer' | 'internal';

export interface DocComposeContext {
  readonly tenant_id: string;
  readonly intent_payload: unknown;
  readonly available_data: ReadonlyArray<DataJoin>;
  readonly research_result_id: string | null;
  readonly owner_profile: OwnerProfile;
  readonly mastery_tier: MasteryTier;
  readonly target_audience: TargetAudience;
  readonly language: 'en' | 'sw';
  /** Citations the upstream retriever has supplied. The composer is
   *  free to add more, but every numeric / dated / regulatory claim
   *  in the produced artifact must reference one of these. */
  readonly citations: ReadonlyArray<SpanCitation>;
  /** Reproducibility seed — pin the renderer's "now" so checksums are
   *  stable across runs in tests. Optional in production. */
  readonly generated_at?: string;
  /** Storage bucket override — defaults to `borjie-docs-${class}`. */
  readonly storage_bucket?: string;
}

// ---------------------------------------------------------------------------
// IRDoc — brand-agnostic intermediate representation.
// Composer emits this; brander walks it.
// ---------------------------------------------------------------------------

export type IRBlockKind =
  | 'heading'
  | 'paragraph'
  | 'kpi_grid'
  | 'table'
  | 'chart_placeholder'
  | 'citation_footnote'
  | 'signature_block'
  | 'watermark';

export interface IRBlock {
  readonly kind: IRBlockKind;
  readonly text?: string | undefined;
  readonly level?: 1 | 2 | 3 | undefined;
  readonly rows?: ReadonlyArray<ReadonlyArray<string>> | undefined;
  readonly headers?: ReadonlyArray<string> | undefined;
  readonly kpis?:
    | ReadonlyArray<{
        readonly label: string;
        readonly value: string;
        readonly citationId?: string | undefined;
      }>
    | undefined;
  readonly citationId?: string | undefined;
}

export interface IRSection {
  readonly id: string;
  readonly title: string;
  readonly blocks: ReadonlyArray<IRBlock>;
  /** Citations referenced inside this section (footnotes resolve to these). */
  readonly citationIds: ReadonlyArray<string>;
}

export interface IRDoc {
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly sections: ReadonlyArray<IRSection>;
  readonly citations: ReadonlyArray<SpanCitation>;
  readonly watermark: 'draft' | 'final';
  /** ISO 8601 generation time — pinned for deterministic checksums. */
  readonly generated_at: string;
}

// ---------------------------------------------------------------------------
// Artifact — the persisted output.
// ---------------------------------------------------------------------------

export interface DocumentArtifact {
  readonly id: string;
  readonly recipe_id: string;
  readonly recipe_version: number;
  readonly format: DocumentFormat;
  readonly storage_key: string;
  readonly checksum: string;
  readonly span_citations: ReadonlyArray<SpanCitation>;
  readonly audit_hash: string;
  readonly approval_state: ApprovalState;
  readonly approved_by?: string;
  readonly approved_at?: string;
  /** Raw artifact bytes (binary formats) or string (text formats). The
   *  caller persists these to Supabase Storage under `storage_key`. */
  readonly body: Buffer | string;
  /** ISO 8601 wall-clock when the artifact was sealed. */
  readonly generated_at: string;
}

// ---------------------------------------------------------------------------
// DocumentRecipe — the registry entry.
// ---------------------------------------------------------------------------

export interface DocumentRecipe {
  readonly id: string;
  readonly class: DocumentClass;
  readonly version: number;
  readonly status: RecipeStatus;
  readonly compose: (ctx: DocComposeContext) => Promise<DocumentArtifact>;
  readonly required_inputs: ReadonlyArray<InputContract>;
  readonly required_citations: ReadonlyArray<CitationContract>;
  readonly output_formats: ReadonlyArray<DocumentFormat>;
  readonly authority_tier: AuthorityTier;
  readonly brand: 'borjie';
  readonly approval_required: boolean;
}

// ---------------------------------------------------------------------------
// Failure modes — composition refuses rather than ships a bad doc.
// ---------------------------------------------------------------------------

export class CompositionError extends Error {
  public readonly code:
    | 'INPUT_GAP'
    | 'CITATION_GAP'
    | 'BRAND_VIOLATION'
    | 'RECIPE_NOT_FOUND'
    | 'UNSUPPORTED_FORMAT'
    | 'STATE_TRANSITION_REFUSED';

  public readonly detail: ReadonlyArray<string>;

  public constructor(
    code: CompositionError['code'],
    message: string,
    detail: ReadonlyArray<string> = [],
  ) {
    super(message);
    this.name = 'CompositionError';
    this.code = code;
    this.detail = detail;
  }
}
