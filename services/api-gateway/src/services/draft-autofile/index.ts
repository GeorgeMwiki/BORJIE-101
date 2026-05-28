/**
 * Draft Auto-Filer — Chat-as-OS Bidirectional Parity, principle 10.
 *
 * When a draft is composed via chat (the universal drafter's
 * `composeFreeForm` path, sibling #128), this service infers the
 * right Documents-tab folder + sub-folder from the draft's
 * `inferredKind` and `counterparty` fields and writes a tiny
 * companion record so the Documents UI can render the draft inside
 * the inferred folder by default.
 *
 * The owner can drag-drop the draft to a different folder at any
 * time; the re-folder is itself recorded as a revision with
 * `provenance.via = 'form'` so the audit trail keeps both decisions.
 *
 * Sibling-agent boundary:
 *
 *   - The drafter service in `services/api-gateway/src/services/document-drafter/*`
 *     (sibling #128) owns draft composition + persistence. It MUST
 *     NOT be edited by this wave.
 *
 *   - This service is a passive listener: it reads (via injected
 *     port) the drafter's persisted output and emits an autofile
 *     record. The drafter doesn't know about this service.
 *
 * The autofile record lives in a small in-memory map (port pattern)
 * until the drafter exposes a hook. Persistence-port wiring happens
 * in a follow-up PR.
 */

export interface DraftFolderHint {
  /** Draft kind inferred by the brain (e.g. 'mou', 'msa', 'regulator_letter'). */
  readonly inferredKind: string;
  /** Counterparty / regulator name inferred by the brain. */
  readonly inferredCounterparty?: string | null;
  /** Jurisdiction (TZ|KE|UG|...). */
  readonly jurisdiction?: string | null;
}

export interface FolderAssignment {
  /** Documents-tab folder path (e.g. '/docs/regulator-letters'). */
  readonly folder: string;
  /** Optional sub-folder, typically the counterparty name. */
  readonly subFolder?: string;
  /** Human-readable rationale for the assignment (audit-friendly). */
  readonly rationale: string;
}

/** Maps inferred draft kinds → Documents-tab folder paths. */
export const FOLDER_MAP: Readonly<Record<string, string>> = Object.freeze({
  mou: '/docs/mous',
  msa: '/docs/msas',
  contract: '/docs/contracts',
  rfp: '/docs/rfps',
  rfp_response: '/docs/rfp-responses',
  letter: '/docs/letters',
  regulator_letter: '/docs/regulator-letters',
  notice: '/docs/notices',
  memo: '/docs/memos',
  npa: '/docs/non-disclosure',
  nda: '/docs/non-disclosure',
  offtake_agreement: '/docs/offtake-agreements',
  export_permit_request: '/docs/regulator-letters',
  sla: '/docs/slas',
  scope_of_work: '/docs/scope-of-work',
  purchase_order: '/docs/purchase-orders',
});

const DEFAULT_FOLDER = '/docs/other';

/**
 * Pure function: derive the folder + sub-folder for a chat-created
 * draft. The owner can override post-hoc via drag-drop.
 *
 * Why deterministic: the on-call must be able to predict where a
 * given draft will land, and the timeline view must replay the
 * decision (`{via: "chat", auto_filed_to: ...}`).
 */
export function deriveFolderAssignment(
  hint: DraftFolderHint,
): FolderAssignment {
  const kind = hint.inferredKind.toLowerCase().trim();
  const folder = FOLDER_MAP[kind] ?? DEFAULT_FOLDER;
  const sub = sanitiseSubFolder(hint.inferredCounterparty ?? undefined);

  const baseRationale =
    folder === DEFAULT_FOLDER
      ? `inferred kind "${kind}" not in folder map; defaulting to ${DEFAULT_FOLDER}`
      : `inferred kind "${kind}" → ${folder}`;

  const rationale = sub
    ? `${baseRationale}; counterparty "${hint.inferredCounterparty}" → sub-folder "${sub}"`
    : baseRationale;

  return Object.freeze({
    folder,
    ...(sub && { subFolder: sub }),
    rationale,
  }) satisfies FolderAssignment;
}

/**
 * Lowercase, hyphenate, strip non-ASCII. Keeps the sub-folder name
 * filesystem-safe. Returns undefined for an empty / falsy input so
 * the caller can omit the sub-folder cleanly.
 */
function sanitiseSubFolder(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const cleaned = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned.length > 0 ? cleaned : undefined;
}

// ---------------------------------------------------------------------------
// Port — pluggable persistence for downstream wiring
// ---------------------------------------------------------------------------

export interface AutofilePersistencePort {
  /**
   * Record that draft `draftId` was auto-filed under `assignment` by
   * the chat path. The downstream wiring (a worker / Documents-tab
   * read query) consumes this record to render the draft in the
   * right folder.
   */
  recordAssignment(
    tenantId: string,
    draftId: string,
    assignment: FolderAssignment,
    provenance: { readonly via: 'chat'; readonly sessionId: string | null; readonly turnId: string | null },
  ): Promise<void>;
}

/**
 * In-memory implementation. Drop-in for tests; production replaces
 * with a Drizzle-backed port that writes to a small
 * `draft_folder_assignments` table (migration to follow when sibling
 * #128 confirms `composeFreeForm` exposes the hook).
 */
export function createMemoryAutofilePort(): AutofilePersistencePort & {
  readonly assignments: ReadonlyArray<{
    readonly tenantId: string;
    readonly draftId: string;
    readonly assignment: FolderAssignment;
    readonly sessionId: string | null;
    readonly turnId: string | null;
  }>;
} {
  const assignments: Array<{
    tenantId: string;
    draftId: string;
    assignment: FolderAssignment;
    sessionId: string | null;
    turnId: string | null;
  }> = [];
  return {
    assignments,
    async recordAssignment(tenantId, draftId, assignment, provenance) {
      assignments.push({
        tenantId,
        draftId,
        assignment,
        sessionId: provenance.sessionId,
        turnId: provenance.turnId,
      });
    },
  };
}
