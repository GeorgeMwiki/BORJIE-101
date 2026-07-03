'use client';

/**
 * Training-surface gateway client (gap 9 + gap 10).
 *
 * A self-contained typed fetch layer for /api/v1/scenarios/* — the same house
 * convention as the licence-renewal client (a local fetch that forwards the
 * Supabase bearer + session cookie and surfaces the gateway's full
 * `{ success, data, degraded? }` envelope). We do NOT use the shared
 * `apiRequest` unwrapper here because the LIST + checkpoint responses carry a
 * top-level `degraded` flag (a sibling of `data`) that the unwrapper would
 * drop; honest-degrade depends on reading it.
 *
 * PITFALL 1 (NodeNext barrel) — every TYPE comes from the
 * `@borjie/api-client/training-types` tsconfig path alias (→ the service
 * source), never the package barrel, so a NodeNext consumer resolves the type
 * shapes without the barrel's runtime-resolution issue. No VALUE is imported
 * from the api-client here (owner-web fetches natively).
 *
 * HONEST-DEGRADE: a non-2xx surfaces as a typed `TrainingGatewayError` whose
 * `.status` lets the caller branch (503 → service unavailable). Content is
 * NEVER fabricated — an empty / degraded response renders an empty state.
 */

import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { API_BASE } from '@/lib/api-client';
import type {
  ScenarioView,
  ScenarioLanguage,
  ScenarioRoleMode,
  ScenarioDifficulty,
  StartSessionResponse,
  TurnResponse,
  CompleteSessionResponse,
  CheckpointResponse,
  CheckpointSubmitResult,
} from '@borjie/api-client/training-types';

export type {
  ScenarioView,
  ScenarioLanguage,
  ScenarioRoleMode,
  ScenarioDifficulty,
  ScenarioBriefing,
  ScenarioBriefingLine,
  TurnReply,
  StartSessionResponse,
  TurnResponse,
  CompleteSessionResponse,
  CheckpointQuestion,
  CheckpointOption,
  CheckpointResponse,
  CheckpointSubmitResult,
} from '@borjie/api-client/training-types';

const REQUEST_TIMEOUT_MS = 15_000;

/** Typed gateway failure carrying the HTTP status so callers can branch. */
export class TrainingGatewayError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'TrainingGatewayError';
    this.status = status;
  }
}

/** The gateway's success envelope; `degraded` is a top-level sibling of data. */
interface Envelope<T> {
  readonly success: boolean;
  readonly data: T;
  readonly degraded?: boolean;
  readonly error?: { readonly code?: string; readonly message?: string };
}

async function bearerHeader(): Promise<Record<string, string>> {
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

async function call<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<Envelope<T>> {
  const url = `${API_BASE.replace(/\/+$/, '')}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const auth = await bearerHeader();
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...auth,
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const init: RequestInit = {
    method,
    credentials: 'include',
    signal: controller.signal,
    headers,
  };
  if (body !== undefined) init.body = JSON.stringify(body);

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    clearTimeout(timer);
    const message = err instanceof Error ? err.message : 'network unreachable';
    throw new TrainingGatewayError(message, 0);
  }
  clearTimeout(timer);

  let json: Envelope<T> | null = null;
  try {
    json = (await res.json()) as Envelope<T>;
  } catch {
    json = null;
  }

  if (!res.ok || !json || json.success === false) {
    // Internal dev/Sentry field only — carried on the thrown error's
    // `.message`, NEVER rendered as copy (consumers branch on `.status` /
    // `instanceof` and render localised `tr.t(...)`). Named `devMessage` per
    // the api-client convention so it is unambiguously not user-facing.
    const devMessage =
      json?.error?.message ?? `request failed with HTTP ${res.status}`;
    throw new TrainingGatewayError(devMessage, res.status);
  }
  return json;
}

function toQuery(params: Readonly<Record<string, string | undefined>>): string {
  const pairs = Object.entries(params).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0,
  );
  if (pairs.length === 0) return '';
  const usp = new URLSearchParams(pairs);
  return `?${usp.toString()}`;
}

export interface ScenarioListResult {
  readonly scenarios: readonly ScenarioView[];
  readonly degraded: boolean;
}

/** List active scenario templates for the tenant. */
export async function listScenarios(
  language: ScenarioLanguage,
): Promise<ScenarioListResult> {
  const env = await call<readonly ScenarioView[]>(
    'GET',
    `/api/v1/scenarios${toQuery({ language })}`,
  );
  return { scenarios: env.data ?? [], degraded: env.degraded ?? false };
}

/** (Re)generate scenario templates from the concept catalog. */
export async function generateScenarios(
  language: ScenarioLanguage,
  difficulty?: ScenarioDifficulty,
): Promise<ScenarioListResult> {
  const env = await call<readonly ScenarioView[]>('POST', '/api/v1/scenarios/generate', {
    language,
    ...(difficulty ? { difficulty } : {}),
  });
  return { scenarios: env.data ?? [], degraded: env.degraded ?? false };
}

/** Start a run. Role-mode (if any) is validated server-side. */
export async function startSession(
  scenarioId: string,
  roleMode: ScenarioRoleMode | null,
): Promise<StartSessionResponse> {
  const body = roleMode ? { scenarioId, roleMode } : { scenarioId };
  const env = await call<StartSessionResponse>('POST', '/api/v1/scenarios/sessions', body);
  return env.data;
}

/** Append one transcript turn. */
export async function sendTurn(
  sessionId: string,
  message: string,
  coveredConceptIds: readonly string[],
): Promise<TurnResponse> {
  const body =
    coveredConceptIds.length > 0 ? { message, coveredConceptIds } : { message };
  const env = await call<TurnResponse>(
    'POST',
    `/api/v1/scenarios/sessions/${sessionId}/turn`,
    body,
  );
  return env.data;
}

/** Close a run with a final score in [0, 1]. */
export async function completeSession(
  sessionId: string,
  score: number,
  coveredConceptIds: readonly string[],
): Promise<CompleteSessionResponse> {
  const env = await call<CompleteSessionResponse>(
    'POST',
    `/api/v1/scenarios/sessions/${sessionId}/complete`,
    { score, coveredConceptIds },
  );
  return env.data;
}

/** Build a checkpoint (inverse-BKT weighted) for an optional phase/kind. */
export async function fetchCheckpoint(
  language: ScenarioLanguage,
  kind?: string,
): Promise<CheckpointResponse> {
  const env = await call<CheckpointResponse>(
    'GET',
    `/api/v1/scenarios/checkpoint${toQuery({ language, kind })}`,
  );
  return env.data;
}

/** Submit checkpoint results; the 0.7 pass gate is applied server-side. */
export async function submitCheckpoint(
  conceptIds: readonly string[],
  results: ReadonlyArray<{ conceptId: string; correct: boolean }>,
): Promise<CheckpointSubmitResult> {
  const env = await call<CheckpointSubmitResult>(
    'POST',
    '/api/v1/scenarios/checkpoint/submit',
    { conceptIds, results },
  );
  return env.data;
}
