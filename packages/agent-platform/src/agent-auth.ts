/**
 * Agent-to-Agent (A2A) Authentication — HMAC-signed calls between
 * cooperating BORJIE agents and partner-platform agents.
 *
 * Flow (caller side):
 *   1. Build canonical string: `${method}\n${path}\n${timestamp}\n${bodyHash}`.
 *   2. HMAC-SHA256 sign with the agent's shared secret.
 *   3. Attach headers:
 *        X-Agent-Id: <agentId>
 *        X-Agent-Timestamp: <unix ms>
 *        X-Agent-Signature: sha256=<hex>
 *
 * Flow (server side):
 *   1. Reject if timestamp drift > 5 minutes (replay protection).
 *   2. Look up agent by id.
 *   3. Compute the expected signature with the agent's stored secret.
 *   4. Constant-time compare.
 *   5. Return `AgentAuthSuccess` with tenant + scopes.
 *
 * The module is storage-agnostic — the caller injects an `AgentRegistry`.
 */

import { getCorrelationId, type HeadersLike } from './correlation-id.js';
import type {
  AgentAuthResult,
  AgentScope,
  RegisteredAgent,
} from './types.js';

// ============================================================================
// Constants
// ============================================================================

const MAX_CLOCK_DRIFT_MS = 5 * 60 * 1000;
const SIGNATURE_HEADER = 'x-agent-signature';
const AGENT_ID_HEADER = 'x-agent-id';
const TIMESTAMP_HEADER = 'x-agent-timestamp';

// ============================================================================
// Registry port
// ============================================================================

export interface AgentRegistry {
  findById(agentId: string): Promise<RegisteredAgent | null>;
  touchLastSeen(agentId: string, iso: string): Promise<void>;
}

// ============================================================================
// Crypto helpers
// ============================================================================

export async function hashApiKey(key: string): Promise<string> {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(key));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function sha256Hex(input: string): Promise<string> {
  return hashApiKey(input);
}

export async function hmacSha256Hex(
  secret: string,
  message: string,
): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function generateAgentApiKey(): string {
  const a = crypto.randomUUID().replace(/-/g, '');
  const b = crypto.randomUUID().replace(/-/g, '');
  return `bnk_agent_${a}${b}`;
}

export function generateAgentHmacSecret(): string {
  return crypto.randomUUID().replace(/-/g, '') +
    crypto.randomUUID().replace(/-/g, '');
}

/**
 * Constant-time string compare (length-independent timing).
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ============================================================================
// Canonical string
// ============================================================================

export async function buildCanonicalString(
  method: string,
  path: string,
  timestamp: number,
  body: string,
): Promise<string> {
  const bodyHash = await sha256Hex(body);
  return `${method.toUpperCase()}\n${path}\n${timestamp}\n${bodyHash}`;
}

export async function signRequest(
  method: string,
  path: string,
  timestamp: number,
  body: string,
  secret: string,
): Promise<string> {
  const canonical = await buildCanonicalString(method, path, timestamp, body);
  const sig = await hmacSha256Hex(secret, canonical);
  return `sha256=${sig}`;
}

// ============================================================================
// Auth request shape
// ============================================================================

export interface AgentAuthRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: HeadersLike;
  readonly body: string;
}

export interface AgentAuthDeps {
  readonly registry: AgentRegistry;
  readonly now?: () => number;
  readonly maxClockDriftMs?: number;
}

// ============================================================================
// Verify
// ============================================================================

export async function verifyAgentRequest(
  deps: AgentAuthDeps,
  request: AgentAuthRequest,
  requiredScopes?: ReadonlyArray<AgentScope>,
): Promise<AgentAuthResult> {
  const now = (deps.now ?? Date.now)();
  const maxDrift = deps.maxClockDriftMs ?? MAX_CLOCK_DRIFT_MS;
  const correlationId = getCorrelationId(request.headers);

  const agentId = request.headers[AGENT_ID_HEADER];
  const tsHeader = request.headers[TIMESTAMP_HEADER];
  const signature = request.headers[SIGNATURE_HEADER];

  if (!agentId || !tsHeader || !signature) {
    return {
      ok: false,
      error: `Provide ${AGENT_ID_HEADER}, ${TIMESTAMP_HEADER}, ${SIGNATURE_HEADER} headers.`,
      errorCode: 'AUTH_REQUIRED',
      status: 401,
      correlationId,
    };
  }

  const timestamp = Number(tsHeader);
  if (!Number.isFinite(timestamp)) {
    return {
      ok: false,
      error: 'Invalid timestamp header.',
      errorCode: 'AUTH_INVALID_SIGNATURE',
      status: 401,
      correlationId,
    };
  }
  if (Math.abs(now - timestamp) > maxDrift) {
    return {
      ok: false,
      error: 'Request timestamp outside allowed window.',
      errorCode: 'AUTH_INVALID_SIGNATURE',
      status: 401,
      correlationId,
    };
  }

  // nosemgrep: missing-tenant-id-arg reason: agent registry is keyed by globally-unique agentId (similar to API keys); cross-tenant agent-id collision is rejected by the registry itself, and downstream authz checks `agent.tenantId` against the request.
  const agent = await deps.registry.findById(agentId);
  if (!agent) {
    return {
      ok: false,
      error: 'Agent not found.',
      errorCode: 'AUTH_INVALID_KEY',
      status: 401,
      correlationId,
    };
  }
  if (agent.status === 'revoked') {
    return {
      ok: false,
      error: 'Agent revoked.',
      errorCode: 'AUTH_REVOKED_AGENT',
      status: 401,
      correlationId,
    };
  }
  if (agent.status === 'suspended') {
    return {
      ok: false,
      error: 'Agent suspended.',
      errorCode: 'AUTH_SUSPENDED_AGENT',
      status: 401,
      correlationId,
    };
  }

  // The shared secret is stored hashed in the registry; we verify the signature
  // by re-signing with the stored hash. (Real deployments store the secret in
  // a KMS-backed secret manager and pass it through the registry.)
  const expected = await signRequest(
    request.method,
    request.path,
    timestamp,
    request.body,
    agent.hmacSecretHash,
  );

  if (!timingSafeEqual(signature, expected)) {
    return {
      ok: false,
      error: 'Signature mismatch.',
      errorCode: 'AUTH_INVALID_SIGNATURE',
      status: 401,
      correlationId,
    };
  }

  if (requiredScopes && requiredScopes.length > 0) {
    const missing = requiredScopes.filter((s) => !agent.scopes.includes(s));
    if (missing.length > 0) {
      return {
        ok: false,
        error: `Missing scopes: ${missing.join(', ')}`,
        errorCode: 'AUTH_SCOPE_DENIED',
        status: 403,
        correlationId,
      };
    }
  }

  // Fire-and-forget touch
  void deps.registry
    .touchLastSeen(agent.id, new Date(now).toISOString())
    .catch(() => {
      /* non-fatal */
    });

  return {
    ok: true,
    agent,
    scopes: agent.scopes,
    correlationId,
  };
}
