/**
 * Brain API client — wraps the LIVE `/api/v1/brain` endpoint exposed by
 * the api-gateway (see `services/api-gateway/src/routes/brain.hono.ts`).
 *
 * Exposed gateway routes (verified against brain.hono.ts):
 *   POST /api/v1/brain/turn              — submit a turn, get JSON reply
 *   GET  /api/v1/brain/threads           — list the caller's threads
 *   GET  /api/v1/brain/threads/:id       — read one thread + events
 *   GET  /api/v1/brain/health            — registry health probe
 *   GET  /api/v1/brain/personae          — persona roster
 *
 * IMPORTANT: the `/turn` route returns a single JSON envelope — it is
 * NOT a Server-Sent Events stream. The `streamBrainChat` helper below
 * therefore performs one POST and yields a *single* chunk containing
 * the full response text plus citations resolved from the orchestrator
 * `toolCalls`. The UI animates the reveal client-side so the user sees
 * progressive text, but the wire is a one-shot JSON exchange.
 *
 * If/when the gateway adds an SSE variant of /turn (eventsource-parser
 * is already in the dependency tree), this module can switch over by
 * teaching `streamBrainChat` to feed bytes through `createParser` while
 * the rest of the call sites stay unchanged.
 *
 * LIVE-ONLY: failures throw `ApiError`. There is no mock fallback. The
 * page surfaces errors via the react-query error channel and renders an
 * empty-state when `NEXT_PUBLIC_API_GATEWAY_URL` is missing.
 *
 * Immutability: every returned value is constructed fresh; no input
 * arguments are mutated. Matches the global coding-style rule.
 */

import { API_BASE, ApiError, apiRequest } from './api-client';
import { createSupabaseBrowserClient } from './supabase/client';

// ─── Wire shapes returned by brain.hono.ts ─────────────────────────────

/** Tool / junior call recorded by the orchestrator for one turn. */
export interface BrainToolCall {
  readonly name: string;
  readonly status?: string | null;
  readonly latencyMs?: number | null;
  readonly evidenceIds?: ReadonlyArray<string>;
}

/** Optional proposed action surfaced by the orchestrator (PROPOSED_ACTION). */
export interface BrainProposedAction {
  readonly action: string;
  readonly args?: Readonly<Record<string, unknown>>;
}

/** Citation chip rendered alongside an assistant reply. */
export interface BrainCitation {
  readonly id: string;
  readonly mineralCode: string | null;
  readonly section: string | null;
  readonly score: number | null;
  readonly sourceFile: string | null;
}

/** Result of POST /api/v1/brain/turn. */
export interface BrainTurnResult {
  readonly threadId: string;
  readonly finalPersonaId: string;
  readonly responseText: string;
  readonly handoffs: ReadonlyArray<unknown>;
  readonly toolCalls: ReadonlyArray<BrainToolCall>;
  readonly advisorConsulted: boolean;
  readonly proposedAction: BrainProposedAction | null;
  readonly tokensUsed: number;
  readonly citations: ReadonlyArray<BrainCitation>;
}

/** Brain message as persisted in the per-tenant ThreadStore. */
export interface BrainMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant' | 'system';
  readonly content: string;
  readonly createdAt: string;
  readonly personaId?: string | null;
  readonly evidenceIds?: ReadonlyArray<string>;
  readonly citations?: ReadonlyArray<BrainCitation>;
}

interface BrainTurnRequest {
  readonly userText: string;
  readonly threadId?: string;
  readonly forcePersonaId?: string;
}

interface BrainTurnRawResponse {
  readonly threadId?: string;
  readonly finalPersonaId?: string;
  readonly responseText?: string;
  readonly handoffs?: ReadonlyArray<unknown>;
  readonly toolCalls?: ReadonlyArray<unknown>;
  readonly advisorConsulted?: boolean;
  readonly proposedAction?: unknown;
  readonly tokensUsed?: number;
  readonly citations?: ReadonlyArray<unknown>;
}

interface BrainThreadEventRaw {
  readonly id?: string;
  readonly role?: string;
  readonly text?: string;
  readonly content?: string;
  readonly createdAt?: string;
  readonly created_at?: string;
  readonly personaId?: string | null;
  readonly persona_id?: string | null;
  readonly evidenceIds?: ReadonlyArray<string>;
  readonly evidence_ids?: ReadonlyArray<string>;
  readonly citations?: ReadonlyArray<unknown>;
}

interface BrainThreadRawResponse {
  readonly thread?: { readonly id?: string };
  readonly events?: ReadonlyArray<BrainThreadEventRaw>;
}

// ─── Helpers ───────────────────────────────────────────────────────────

/**
 * True when an api-gateway base URL is configured. Falls back to the
 * shared `API_BASE` (which itself uses localhost:3001 in dev). When the
 * `NEXT_PUBLIC_API_GATEWAY_URL` env var is missing in production the
 * caller should render the "Connect to Borjie backend" empty state.
 */
export function isBrainConfigured(): boolean {
  if (typeof process === 'undefined') return false;
  return Boolean(process.env.NEXT_PUBLIC_API_GATEWAY_URL?.trim());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normaliseToolCall(value: unknown): BrainToolCall | null {
  if (!isRecord(value)) return null;
  const name =
    typeof value.name === 'string'
      ? value.name
      : typeof value.tool === 'string'
        ? value.tool
        : typeof value.junior === 'string'
          ? value.junior
          : null;
  if (!name) return null;
  const status =
    typeof value.status === 'string' ? value.status : null;
  const latencyMs =
    typeof value.latencyMs === 'number'
      ? value.latencyMs
      : typeof value.latency_ms === 'number'
        ? value.latency_ms
        : null;
  const evidenceIdsRaw = Array.isArray(value.evidenceIds)
    ? value.evidenceIds
    : Array.isArray(value.evidence_ids)
      ? value.evidence_ids
      : [];
  const evidenceIds: ReadonlyArray<string> = evidenceIdsRaw.filter(
    (v): v is string => typeof v === 'string',
  );
  return {
    name,
    status,
    latencyMs,
    evidenceIds,
  };
}

function normaliseCitation(value: unknown): BrainCitation | null {
  if (!isRecord(value)) return null;
  const id =
    typeof value.id === 'string'
      ? value.id
      : typeof value.chunkId === 'string'
        ? value.chunkId
        : typeof value.chunk_id === 'string'
          ? value.chunk_id
          : null;
  if (!id) return null;
  const mineralCode =
    typeof value.mineralCode === 'string'
      ? value.mineralCode
      : typeof value.mineral_code === 'string'
        ? value.mineral_code
        : null;
  const section =
    typeof value.section === 'string'
      ? value.section
      : typeof value.sectionLabel === 'string'
        ? value.sectionLabel
        : typeof value.section_label === 'string'
          ? value.section_label
          : null;
  const score =
    typeof value.score === 'number'
      ? value.score
      : typeof value.similarity === 'number'
        ? value.similarity
        : null;
  const sourceFile =
    typeof value.sourceFile === 'string'
      ? value.sourceFile
      : typeof value.source_file === 'string'
        ? value.source_file
        : typeof value.source === 'string'
          ? value.source
          : null;
  return {
    id,
    mineralCode,
    section,
    score,
    sourceFile,
  };
}

function normaliseProposedAction(value: unknown): BrainProposedAction | null {
  if (!isRecord(value)) return null;
  if (typeof value.action !== 'string' || !value.action) return null;
  const args = isRecord(value.args) ? { ...value.args } : undefined;
  return args === undefined ? { action: value.action } : { action: value.action, args };
}

function normaliseTurnResult(raw: BrainTurnRawResponse): BrainTurnResult {
  const toolCalls: BrainToolCall[] = [];
  if (Array.isArray(raw.toolCalls)) {
    for (const c of raw.toolCalls) {
      const normalised = normaliseToolCall(c);
      if (normalised) toolCalls.push(normalised);
    }
  }
  const citations: BrainCitation[] = [];
  if (Array.isArray(raw.citations)) {
    for (const c of raw.citations) {
      const normalised = normaliseCitation(c);
      if (normalised) citations.push(normalised);
    }
  }
  // Fall back: if the wire didn't include a top-level `citations` array
  // but tool calls carry `evidenceIds`, surface those as opaque citations
  // so the UI still has a chip to render (with score=null).
  if (citations.length === 0) {
    const seen = new Set<string>();
    for (const tc of toolCalls) {
      for (const id of tc.evidenceIds ?? []) {
        if (seen.has(id)) continue;
        seen.add(id);
        citations.push({
          id,
          mineralCode: null,
          section: tc.name,
          score: null,
          sourceFile: null,
        });
      }
    }
  }
  return {
    threadId: typeof raw.threadId === 'string' ? raw.threadId : '',
    finalPersonaId:
      typeof raw.finalPersonaId === 'string' ? raw.finalPersonaId : 'unknown',
    responseText: typeof raw.responseText === 'string' ? raw.responseText : '',
    handoffs: Array.isArray(raw.handoffs) ? [...raw.handoffs] : [],
    toolCalls,
    advisorConsulted: Boolean(raw.advisorConsulted),
    proposedAction: normaliseProposedAction(raw.proposedAction),
    tokensUsed: typeof raw.tokensUsed === 'number' ? raw.tokensUsed : 0,
    citations,
  };
}

function normaliseThreadEvent(raw: BrainThreadEventRaw): BrainMessage | null {
  const role = raw.role;
  if (role !== 'user' && role !== 'assistant' && role !== 'system') return null;
  const content =
    typeof raw.content === 'string'
      ? raw.content
      : typeof raw.text === 'string'
        ? raw.text
        : '';
  const id = typeof raw.id === 'string' && raw.id ? raw.id : `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const createdAt =
    typeof raw.createdAt === 'string'
      ? raw.createdAt
      : typeof raw.created_at === 'string'
        ? raw.created_at
        : new Date().toISOString();
  const personaId =
    typeof raw.personaId === 'string'
      ? raw.personaId
      : typeof raw.persona_id === 'string'
        ? raw.persona_id
        : null;
  const evidenceIdsRaw = Array.isArray(raw.evidenceIds)
    ? raw.evidenceIds
    : Array.isArray(raw.evidence_ids)
      ? raw.evidence_ids
      : [];
  const evidenceIds: ReadonlyArray<string> = evidenceIdsRaw.filter(
    (v): v is string => typeof v === 'string',
  );
  const citations: BrainCitation[] = [];
  if (Array.isArray(raw.citations)) {
    for (const c of raw.citations) {
      const normalised = normaliseCitation(c);
      if (normalised) citations.push(normalised);
    }
  }
  return {
    id,
    role,
    content,
    createdAt,
    personaId,
    evidenceIds,
    citations,
  };
}

// ─── Public API ────────────────────────────────────────────────────────

/**
 * Submit a turn to `POST /api/v1/brain/turn`. Returns the orchestrator's
 * final JSON envelope (single response — the route does not stream).
 *
 * Throws `ApiError` on non-2xx. Bubbles up to the react-query mutation
 * `error` so the UI can render a clear message without crashing.
 */
export async function submitBrainTurn(
  req: BrainTurnRequest,
  init: { readonly signal?: AbortSignal } = {},
): Promise<BrainTurnResult> {
  const body: Record<string, unknown> = { userText: req.userText };
  if (req.threadId) body.threadId = req.threadId;
  if (req.forcePersonaId) body.forcePersonaId = req.forcePersonaId;
  const raw = await apiRequest<BrainTurnRawResponse>('/api/v1/brain/turn', {
    method: 'POST',
    body,
    ...(init.signal ? { signal: init.signal } : {}),
  });
  return normaliseTurnResult(raw ?? {});
}

/**
 * Issue a brand-new thread by submitting a placeholder turn. The brain
 * orchestrator allocates the threadId server-side on the first turn —
 * there is no dedicated `POST /threads` route in brain.hono.ts.
 *
 * Callers typically prefer to delay thread creation until the user types
 * their first real question; `createThread` is exposed for the rare
 * case where a thread id is needed in advance (e.g. URL-driven flows).
 */
export async function createThread(
  initialUserText: string,
  init: { readonly signal?: AbortSignal } = {},
): Promise<{ readonly threadId: string }> {
  if (!initialUserText.trim()) {
    throw new ApiError('initial user text required', 400);
  }
  const result = await submitBrainTurn(
    { userText: initialUserText },
    init,
  );
  if (!result.threadId) {
    throw new ApiError('brain did not return a threadId', 500);
  }
  return { threadId: result.threadId };
}

/**
 * Load the event log for a thread via `GET /api/v1/brain/threads/:id`.
 *
 * Returns the message list normalised to the on-screen shape. Throws
 * `ApiError` if the thread does not exist or the caller's tenant claim
 * doesn't match (gateway returns 404 in both cases — by design).
 */
export async function loadThread(
  threadId: string,
  init: { readonly signal?: AbortSignal } = {},
): Promise<{ readonly threadId: string; readonly messages: ReadonlyArray<BrainMessage> }> {
  if (!threadId) throw new ApiError('threadId required', 400);
  const raw = await apiRequest<BrainThreadRawResponse>(
    `/api/v1/brain/threads/${encodeURIComponent(threadId)}`,
    init.signal ? { signal: init.signal } : {},
  );
  const events = Array.isArray(raw?.events) ? raw!.events : [];
  const messages: BrainMessage[] = [];
  for (const ev of events) {
    const normalised = normaliseThreadEvent(ev);
    if (normalised) messages.push(normalised);
  }
  return {
    threadId: raw?.thread?.id ?? threadId,
    messages,
  };
}

/**
 * One chunk yielded by `streamBrainChat`. The brain `/turn` route does
 * not natively stream, so this iterable yields exactly one terminal
 * chunk carrying the full text + citations. Existing call sites
 * (FloatingAskBorjie etc.) consume this as if it were SSE deltas —
 * cleanly switchable to real SSE once the gateway exposes it.
 */
export interface BrainStreamChunk {
  readonly chunk: string;
  readonly citations: ReadonlyArray<BrainCitation>;
  readonly threadId: string;
  readonly finalPersonaId: string;
  readonly toolCalls: ReadonlyArray<BrainToolCall>;
  readonly done: boolean;
}

interface StreamBrainChatArgs {
  readonly message: string;
  readonly threadId?: string;
  readonly forcePersonaId?: string;
  readonly signal?: AbortSignal;
}

/**
 * Async iterable that yields one final chunk for a brain turn.
 *
 * The wire is JSON (non-streaming) — the iterable interface is kept so
 * the UI can transparently switch to a future SSE variant of /turn
 * without touching call sites.
 *
 * Throws `ApiError` on failure; consumers should wrap with try/catch
 * or surface the error via react-query.
 */
export async function* streamBrainChat(
  args: StreamBrainChatArgs,
): AsyncIterable<BrainStreamChunk> {
  const result = await submitBrainTurn(
    {
      userText: args.message,
      ...(args.threadId ? { threadId: args.threadId } : {}),
      ...(args.forcePersonaId ? { forcePersonaId: args.forcePersonaId } : {}),
    },
    args.signal ? { signal: args.signal } : {},
  );
  yield {
    chunk: result.responseText,
    citations: result.citations,
    threadId: result.threadId,
    finalPersonaId: result.finalPersonaId,
    toolCalls: result.toolCalls,
    done: true,
  };
}

/**
 * Returns the current Supabase access token (or null). Re-exported here
 * so call sites don't need to import supabase/client directly.
 */
export async function getBrainAccessToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  try {
    const supabase = createSupabaseBrowserClient();
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

export { API_BASE, ApiError };
