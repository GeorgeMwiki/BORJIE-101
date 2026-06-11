/**
 * Wave 9 client API — shapes requests/responses for the five admin-web
 * surfaces that front already-mounted gateway routes via the
 * `/api/platform/*` BFF proxies:
 *
 *   - Proposals approval queue   (/api/platform/proposals)
 *   - Junior-AI Factory          (/api/platform/junior-ai)
 *   - Task-Agents registry       (/api/platform/task-agents)
 *   - Persona Registry           (/api/platform/persona-registry)
 *   - Workflow + flow-autonomy   (/api/platform/workflow/*)
 *
 * Auth: same-origin fetch forwards the staff session cookie; mutating
 * calls echo the double-submit CSRF token via getCsrfHeaders(). Failures
 * throw so react-query's `error` channel surfaces a clean degraded state.
 * No tenant business data crosses this layer — every payload is platform /
 * operational metadata the gateway already gates by role.
 */

import { getCsrfHeaders } from '@/lib/csrf';

// ─── Shared envelope ─────────────────────────────────────────────────────────

interface Envelope<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: { readonly message?: string; readonly code?: string };
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
  const body = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (!res.ok || !body?.success || body.data === undefined) {
    throw new Error(
      body?.error?.message ?? `request failed (${body?.error?.code ?? res.status})`,
    );
  }
  return body.data;
}

async function sendJson<T>(
  url: string,
  method: 'POST' | 'PUT' | 'DELETE',
  payload?: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...getCsrfHeaders() },
    body: JSON.stringify(payload ?? {}),
  });
  const body = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (!res.ok || !body?.success || body.data === undefined) {
    throw new Error(
      body?.error?.message ?? `request failed (${body?.error?.code ?? res.status})`,
    );
  }
  return body.data;
}

// ─── Proposals approval queue ────────────────────────────────────────────────

export interface Proposal {
  readonly id: string;
  readonly moduleTemplateId: string | null;
  readonly action: string | null;
  readonly personaId: string | null;
  readonly status: string;
  readonly confidence: number | null;
  readonly hitlRequired: boolean | null;
  readonly priority: string | number | null;
  readonly createdAt: string | null;
  readonly expiresAt: string | null;
}

interface ProposalListResponse {
  readonly items?: ReadonlyArray<Proposal>;
  readonly data?: ReadonlyArray<Proposal>;
}

/**
 * The proposals list route returns the shared `buildListResponse` shape,
 * which is NOT the `{ success, data }` envelope — it carries `items` at the
 * top level. We read it directly rather than through getJson().
 */
export async function fetchPendingProposals(): Promise<ReadonlyArray<Proposal>> {
  const res = await fetch('/api/platform/proposals?status=pending_hitl', {
    credentials: 'include',
    cache: 'no-store',
  });
  const body = (await res.json().catch(() => null)) as
    | (ProposalListResponse & Envelope<unknown>)
    | null;
  if (!res.ok) {
    throw new Error(body?.error?.message ?? `request failed (${res.status})`);
  }
  return body?.items ?? body?.data ?? [];
}

export interface ApproveProposalInput {
  readonly id: string;
  readonly approverTier: number;
  readonly notes?: string;
}

export async function approveProposal(
  input: ApproveProposalInput,
): Promise<{ readonly id: string; readonly status: string }> {
  return sendJson(`/api/platform/proposals/${encodeURIComponent(input.id)}/approve`, 'POST', {
    approver_tier: input.approverTier,
    ...(input.notes ? { notes: input.notes } : {}),
  });
}

export interface DeclineProposalInput {
  readonly id: string;
  readonly reason: string;
}

export async function declineProposal(
  input: DeclineProposalInput,
): Promise<{ readonly id: string; readonly status: string }> {
  return sendJson(`/api/platform/proposals/${encodeURIComponent(input.id)}/decline`, 'POST', {
    reason: input.reason,
  });
}

// ─── Junior-AI Factory ───────────────────────────────────────────────────────

export interface JuniorAi {
  readonly id: string;
  readonly domain: string;
  readonly mandate: string;
  readonly status: string;
  readonly memoryScope?: string;
  readonly certificationRequired?: boolean;
  readonly createdAt?: string;
}

export function fetchJuniorAis(): Promise<ReadonlyArray<JuniorAi>> {
  return getJson<ReadonlyArray<JuniorAi>>('/api/platform/junior-ai');
}

export interface SuspendJuniorInput {
  readonly id: string;
  readonly reason: string;
}

export function suspendJunior(input: SuspendJuniorInput): Promise<JuniorAi> {
  return sendJson(`/api/platform/junior-ai/${encodeURIComponent(input.id)}/suspend`, 'POST', {
    reason: input.reason,
  });
}

export function revokeJunior(id: string): Promise<JuniorAi> {
  return sendJson(`/api/platform/junior-ai/${encodeURIComponent(id)}/revoke`, 'POST', {});
}

// ─── Task-Agents registry ────────────────────────────────────────────────────

export interface TaskAgent {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly trigger: string;
  readonly guardrails: {
    readonly autonomyDomain: string;
    readonly autonomyAction: string;
    readonly description: string;
    readonly invokesLLM: boolean;
  };
}

export interface TaskAgentListData {
  readonly agents: ReadonlyArray<TaskAgent>;
  readonly total: number;
}

export function fetchTaskAgents(): Promise<TaskAgentListData> {
  return getJson<TaskAgentListData>('/api/platform/task-agents');
}

export interface RunTaskAgentInput {
  readonly id: string;
  readonly payload: Record<string, unknown>;
}

export function runTaskAgent(input: RunTaskAgentInput): Promise<unknown> {
  return sendJson(`/api/platform/task-agents/${encodeURIComponent(input.id)}/run`, 'POST', {
    payload: input.payload,
  });
}

// ─── Persona Registry ────────────────────────────────────────────────────────

export interface Persona {
  readonly id: string;
  readonly displayName: string;
  readonly openingStatement: string;
  readonly toneGuidance: string;
  readonly taboos: ReadonlyArray<string>;
  readonly violationSignals: ReadonlyArray<string>;
  readonly firstPersonNoun: string;
}

export async function fetchPersonas(): Promise<ReadonlyArray<Persona>> {
  const data = await getJson<unknown>('/api/platform/persona-registry');
  return Array.isArray(data) ? (data as ReadonlyArray<Persona>) : [];
}

export function refreshPersonas(): Promise<{ readonly refreshed: boolean }> {
  return sendJson('/api/platform/persona-registry/refresh', 'POST', {});
}

export function deletePersona(id: string): Promise<{ readonly id: string }> {
  return sendJson(`/api/platform/persona-registry/${encodeURIComponent(id)}`, 'DELETE');
}

// ─── Workflow + flow-autonomy (read-first) ───────────────────────────────────

export interface WorkflowRun {
  readonly id: string;
  readonly definitionId?: string;
  readonly state?: string;
  readonly status?: string;
  readonly scope?: string;
  readonly scopeRef?: string;
  readonly createdAt?: string;
}

export async function fetchMyWorkflowQueue(): Promise<ReadonlyArray<WorkflowRun>> {
  const data = await getJson<unknown>('/api/platform/workflow/my-queue');
  return Array.isArray(data) ? (data as ReadonlyArray<WorkflowRun>) : [];
}

export interface FlowAutonomyPref {
  readonly flowId: string;
  readonly posture: 'auto' | 'gated';
  readonly riskCeiling?: string | null;
  readonly amountThreshold?: number | null;
  readonly updatedAt?: string;
}

export async function fetchFlowAutonomy(
  pending: boolean,
): Promise<ReadonlyArray<FlowAutonomyPref>> {
  const url = pending
    ? '/api/platform/workflow/flow-autonomy?pending=1'
    : '/api/platform/workflow/flow-autonomy';
  const data = await getJson<unknown>(url);
  return Array.isArray(data) ? (data as ReadonlyArray<FlowAutonomyPref>) : [];
}
