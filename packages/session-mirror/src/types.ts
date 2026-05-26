/**
 * `@borjie/session-mirror` — canonical types.
 *
 * The three observability tiers from `Docs/DESIGN/UNIVERSAL_OBSERVABILITY_SPEC.md`
 * land here. Tier I (`UniversalDataAccess`) is sketched as an opaque
 * contract — concrete query-builder shapes belong with the consuming
 * package (`@borjie/database` / `@borjie/ai-copilot`) so the
 * tenant-scoped Drizzle types stay co-located with the schemas. This
 * package owns Tier II (`FieldStateMirror`) and Tier III
 * (`UiStateGraph`) types directly because they are produced here.
 *
 * All types are deeply readonly. Mutation is a contract violation —
 * the api-gateway constructs the context once per turn and ships it
 * unchanged through the capability dispatch.
 */

// ---------------------------------------------------------------------------
// Tier II — Field state
// ---------------------------------------------------------------------------

/**
 * One in-flight field value as the MD sees it. The actual value is
 * either kept in-plaintext (low-sensitivity fields) or replaced with
 * `valueHash` (PII fields hashed at the boundary).
 *
 * The owner is the boundary — a value never leaves the browser if the
 * PII redactor flagged it. The MD reads `valueHash` for identity-style
 * matches and reads `valuePlaintext` only when the redactor passed the
 * value through.
 */
export interface FieldValue {
  readonly tabId: string;
  readonly fieldId: string;
  readonly capturedAt: string;
  /** Set when the value was deemed safe-to-send. Mutually exclusive with `valueHash`. */
  readonly valuePlaintext?: string;
  /** Set when the value was PII-redacted at the boundary. */
  readonly valueHash?: string;
  /** Always set — the redactor's classification of the value. */
  readonly piiKind: PiiKind;
}

export type PiiKind =
  | 'none'
  | 'email'
  | 'phone'
  | 'card'
  | 'nida'
  | 'kra-pin'
  | 'tin'
  | 'iban'
  | 'passport'
  | 'mpesa';

export interface FieldStateMirror {
  /** Read the current in-flight draft for the given tab + field. */
  readonly read: (tabId: string, fieldId: string) => Promise<FieldValue | null>;
  /** Snapshot every in-flight draft for the active session. */
  readonly snapshot: () => Promise<ReadonlyMap<string, FieldValue>>;
  /** Resolve on the next change for this field, or null on timeout. */
  readonly waitForChange: (
    tabId: string,
    fieldId: string,
    timeoutMs: number,
  ) => Promise<FieldValue | null>;
}

// ---------------------------------------------------------------------------
// Tier III — UI state
// ---------------------------------------------------------------------------

export interface TabState {
  readonly id: string;
  readonly recipeId: string;
  readonly recipeVersion: number;
  readonly openedAt: string;
  readonly isDirty: boolean;
  readonly isActive: boolean;
}

export interface HoverTarget {
  readonly tabId: string;
  readonly fieldId: string | null;
  readonly elementRole: string | null;
}

export interface LastUserEvent {
  readonly kind: 'click' | 'keypress' | 'scroll' | 'hover';
  readonly ts: string;
}

export interface UiStateGraph {
  readonly activeTabId: string | null;
  readonly tabs: ReadonlyArray<TabState>;
  readonly activePanelId: string | null;
  readonly activeDialogId: string | null;
  readonly hoverTarget: HoverTarget | null;
  readonly scrollPosition: { tabId: string; y: number } | null;
  readonly lastUserEvent: LastUserEvent | null;
}

// ---------------------------------------------------------------------------
// Capture-event envelope (client → server)
// ---------------------------------------------------------------------------

/**
 * One discrete event emitted by the client-side capture hooks. The
 * provider batches up to 50 of these (or up to 500ms of accumulation)
 * before POSTing to `/api/v1/session-mirror/capture`.
 */
export type CaptureEvent =
  | {
      readonly kind: 'field_change';
      readonly emittedAt: string;
      readonly sessionId: string;
      readonly tabId: string;
      readonly fieldId: string;
      readonly value: FieldValue;
    }
  | {
      readonly kind: 'ui_state';
      readonly emittedAt: string;
      readonly sessionId: string;
      readonly graph: UiStateGraph;
    };

export interface CaptureBatch {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly events: ReadonlyArray<CaptureEvent>;
}

// ---------------------------------------------------------------------------
// Tier I sketch — concrete builders live in @borjie/database
// ---------------------------------------------------------------------------

/**
 * Opaque marker interface — the concrete query-builder for each
 * tenant-scoped Drizzle table is defined in `@borjie/database`. This
 * stays minimal so the session-mirror package does not pull the entire
 * Drizzle surface into the bundle.
 */
export interface QueryBuilderBase<TFilter, TRow> {
  readonly list: (filter?: TFilter) => Promise<ReadonlyArray<TRow>>;
  readonly byId: (id: string) => Promise<TRow | null>;
}

/** Universal fallback for dynamic-recipe authoring. Logged as `arbitrary_query`. */
export interface ArbitraryQuerySpec {
  readonly table: string;
  readonly filter: Readonly<Record<string, unknown>>;
  readonly limit?: number;
}
