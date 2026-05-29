/**
 * Brain API client — admin-web copy.
 *
 * Wraps the LIVE `/api/v1/brain` endpoint exposed by api-gateway. Mirrors
 * the owner-web client (`apps/owner-web/src/lib/brain-api.ts`) so the
 * admin console talks to the exact same orchestrator surface, but kept
 * local so admin-web has no cross-app source dependency.
 *
 * Gateway routes used here:
 *   POST /api/v1/brain/turn              — submit a turn, JSON envelope
 *   GET  /api/v1/brain/threads/:id       — read one thread + events
 *
 * Auth: forwards the Supabase Auth access token as
 * `Authorization: Bearer ...`. The browser client owns the session via
 * @supabase/ssr cookies; access token is read per-request so refreshed
 * tokens are picked up without a page reload.
 *
 * Persona: callers SHOULD pass `forcePersonaId: 'T2_admin_strategist'`
 * for the internal admin surface so the orchestrator routes turns to the
 * tier-2 all-tenant persona. Admin sees data across every tenant, so the
 * persona seed for `T2_admin_strategist` is the correct one (cf.
 * `packages/persona-runtime/src/seeds.ts`).
 *
 * LIVE-only: there is no mock fallback. Failures throw `ApiError`. The
 * react-query layer surfaces the error through its `error` channel and
 * the consuming UI renders an empty state when
 * `NEXT_PUBLIC_API_GATEWAY_URL` is missing.
 *
 * Immutability: every returned value is constructed fresh; inputs are
 * never mutated. Matches the global coding-style rule.
 */

import { createSupabaseBrowserClient } from './supabase/client';
import { requirePublicBaseUrl } from './env-guard';

const REQUEST_TIMEOUT_MS = 8_000;

// Resolved at module load time. In production builds, requirePublicBaseUrl
// throws when NEXT_PUBLIC_API_GATEWAY_URL is unset — we'd rather fail
// fast at boot than silently fetch from localhost in a deployed admin
// console. In `next dev`, the localhost:3001 fallback is the same as
// before this hardening.
export const API_BASE: string = requirePublicBaseUrl(
  'NEXT_PUBLIC_API_GATEWAY_URL',
  'http://localhost:3001',
);

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// ─── Wire shapes returned by brain.hono.ts ─────────────────────────────

export interface BrainToolCall {
  readonly name: string;
  readonly status?: string | null;
  readonly latencyMs?: number | null;
  readonly evidenceIds?: ReadonlyArray<string>;
}

export interface BrainProposedAction {
  readonly action: string;
  readonly args?: Readonly<Record<string, unknown>>;
}

export interface BrainCitation {
  readonly id: string;
  readonly mineralCode: string | null;
  readonly section: string | null;
  readonly score: number | null;
  readonly sourceFile: string | null;
}

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

export interface BrainMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant' | 'system';
  readonly content: string;
  readonly createdAt: string;
  readonly personaId?: string | null;
  readonly evidenceIds?: ReadonlyArray<string>;
  readonly citations?: ReadonlyArray<BrainCitation>;
}

export interface BrainTurnRequest {
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
 * True when an api-gateway base URL is configured. When the env var is
 * missing in production the caller should render the "Connect to Borjie
 * backend" empty state — no implicit localhost fallback in that path.
 */
export function isBrainConfigured(): boolean {
  if (typeof process === 'undefined') return false;
  return Boolean(process.env.NEXT_PUBLIC_API_GATEWAY_URL?.trim());
}

async function authHeaders(): Promise<Record<string, string>> {
  if (typeof window === 'undefined') return {};
  try {
    const supabase = createSupabaseBrowserClient();
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

function withTimeout(externalSignal: AbortSignal | undefined): {
  readonly signal: AbortSignal;
  readonly cancel: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else
      externalSignal.addEventListener('abort', () => controller.abort(), {
        once: true,
      });
  }
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
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
  const status = typeof value.status === 'string' ? value.status : null;
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
  return { name, status, latencyMs, evidenceIds };
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
  return { id, mineralCode, section, score, sourceFile };
}

function normaliseProposedAction(
  value: unknown,
): BrainProposedAction | null {
  if (!isRecord(value)) return null;
  if (typeof value.action !== 'string' || !value.action) return null;
  const args = isRecord(value.args) ? { ...value.args } : undefined;
  return args === undefined
    ? { action: value.action }
    : { action: value.action, args };
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
    responseText:
      typeof raw.responseText === 'string' ? raw.responseText : '',
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
  if (role !== 'user' && role !== 'assistant' && role !== 'system') {
    return null;
  }
  const content =
    typeof raw.content === 'string'
      ? raw.content
      : typeof raw.text === 'string'
        ? raw.text
        : '';
  const id =
    typeof raw.id === 'string' && raw.id
      ? raw.id
      : `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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

interface ApiRequestOptions {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly body?: unknown;
  readonly signal?: AbortSignal;
  readonly headers?: Record<string, string>;
}

async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const url = `${API_BASE.replace(/\/+$/, '')}${
    path.startsWith('/') ? path : `/${path}`
  }`;
  const { signal, cancel } = withTimeout(options.signal);
  const auth = await authHeaders();
  const init: RequestInit = {
    method: options.method ?? 'GET',
    credentials: 'include',
    signal,
    headers: {
      Accept: 'application/json',
      ...auth,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
  };
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'network unreachable';
    throw new ApiError(message, 0);
  } finally {
    cancel();
  }

  if (!response.ok) {
    let body = '';
    try {
      body = await response.text();
    } catch {
      body = response.statusText;
    }
    throw new ApiError(
      body || `request failed with HTTP ${response.status}`,
      response.status,
    );
  }
  if (response.status === 204) return undefined as T;
  const parsed = (await response.json()) as
    | { success?: boolean; data?: T }
    | T;
  if (
    parsed &&
    typeof parsed === 'object' &&
    'success' in parsed &&
    'data' in parsed
  ) {
    return parsed.data as T;
  }
  return parsed as T;
}

// ─── Public API ────────────────────────────────────────────────────────

/**
 * Submit a turn to `POST /api/v1/brain/turn`. Returns the orchestrator's
 * final JSON envelope. Throws `ApiError` on non-2xx so the react-query
 * mutation propagates the failure to its `error` channel.
 */
export async function submitBrainTurn(
  req: BrainTurnRequest,
  init: { readonly signal?: AbortSignal } = {},
): Promise<BrainTurnResult> {
  const body: Record<string, unknown> = { userText: req.userText };
  if (req.threadId) body.threadId = req.threadId;
  if (req.forcePersonaId) body.forcePersonaId = req.forcePersonaId;
  const raw = await apiRequest<BrainTurnRawResponse>(
    '/api/v1/brain/turn',
    {
      method: 'POST',
      body,
      ...(init.signal ? { signal: init.signal } : {}),
    },
  );
  return normaliseTurnResult(raw ?? {});
}

/**
 * Issue a brand-new thread by submitting a placeholder turn. The brain
 * orchestrator allocates the threadId server-side on the first turn —
 * there is no dedicated `POST /threads` route in brain.hono.ts.
 */
export async function createThread(
  initialUserText: string,
  init: { readonly signal?: AbortSignal } = {},
): Promise<{ readonly threadId: string }> {
  if (!initialUserText.trim()) {
    throw new ApiError('initial user text required', 400);
  }
  const result = await submitBrainTurn(
    { userText: initialUserText, forcePersonaId: 'T2_admin_strategist' },
    init,
  );
  if (!result.threadId) {
    throw new ApiError('brain did not return a threadId', 500);
  }
  return { threadId: result.threadId };
}

/**
 * Load the event log for a thread via `GET /api/v1/brain/threads/:id`.
 */
export async function loadThread(
  threadId: string,
  init: { readonly signal?: AbortSignal } = {},
): Promise<{
  readonly threadId: string;
  readonly messages: ReadonlyArray<BrainMessage>;
}> {
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
 * not natively stream; the iterable yields exactly one terminal chunk.
 * The iterable interface lets the UI drop in a future SSE variant
 * without changing call sites.
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

/** Async iterable that yields one terminal chunk for a brain turn. */
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
