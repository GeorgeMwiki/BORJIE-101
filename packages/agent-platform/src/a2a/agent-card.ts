/**
 * A2A v1.0 Agent Card — Google / Linux Foundation spec.
 *
 * The Agent Card is the canonical capability-advertisement object served
 * at `/.well-known/agent.json`. It lets remote agents discover what this
 * agent can do (skills + capabilities), how to authenticate, and where to
 * submit tasks.
 *
 * Spec: https://google-a2a.github.io/A2A/ (v1.0, Signed Agent Cards)
 *
 * This is intentionally smaller and more spec-faithful than the broader
 * `../agent-card.ts` descriptor — that one is BORJIE-internal and lists
 * tools + resources, while this is the A2A wire format consumed by
 * cross-vendor agents (Salesforce, SAP, ServiceNow, Microsoft, etc.).
 */
import { freezeDeep } from './internal/freeze.js';

// ---------------------------------------------------------------------------
// A2A primitives
// ---------------------------------------------------------------------------

export interface A2AAgentCapability {
  readonly id: string;
  readonly description: string;
  readonly inputModes: ReadonlyArray<string>;
  readonly outputModes: ReadonlyArray<string>;
}

export interface A2AAgentSkill {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly tags: ReadonlyArray<string>;
  readonly examples: ReadonlyArray<string>;
}

export interface A2AAgentAuthentication {
  readonly schemes: ReadonlyArray<string>;
  readonly credentialsUrl?: string;
}

export interface A2AAgentEndpoints {
  readonly tasks: string;
  readonly events?: string;
  readonly cancel?: string;
}

export interface A2AAgentSignature {
  readonly algorithm: 'ed25519';
  readonly keyId: string;
  readonly value: string;
  readonly signedAt: string;
}

export interface A2AAgentCard {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly capabilities: ReadonlyArray<A2AAgentCapability>;
  readonly skills: ReadonlyArray<A2AAgentSkill>;
  readonly authentication: A2AAgentAuthentication;
  readonly endpoints: A2AAgentEndpoints;
  readonly signature?: A2AAgentSignature;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export interface A2AAgentCardInput {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly capabilities: ReadonlyArray<A2AAgentCapability>;
  readonly skills: ReadonlyArray<A2AAgentSkill>;
  readonly authentication: A2AAgentAuthentication;
  readonly endpoints: A2AAgentEndpoints;
}

/**
 * Build an unsigned A2A Agent Card. Pass it to
 * `agent-card-signer.ts → signAgentCard` to attach an Ed25519 signature.
 */
export function buildAgentCard(input: A2AAgentCardInput): A2AAgentCard {
  return freezeDeep({
    id: input.id,
    name: input.name,
    description: input.description,
    version: input.version,
    capabilities: input.capabilities,
    skills: input.skills,
    authentication: input.authentication,
    endpoints: input.endpoints,
  }) as A2AAgentCard;
}

/**
 * Serialise an Agent Card to canonical JSON for signing / transport.
 *
 * Canonical = JSON.stringify with sorted top-level keys excluding `signature`.
 * That signature is appended afterwards.
 */
export function serializeAgentCardForSigning(card: A2AAgentCard): string {
  const { signature: _signature, ...unsigned } = card;
  return canonicalStringify(unsigned);
}

/**
 * Serialise an Agent Card (including signature) for transport over the wire.
 */
export function serializeAgentCard(card: A2AAgentCard): string {
  return canonicalStringify(card);
}

/**
 * Parse an Agent Card from JSON. Round-trips with `serializeAgentCard`.
 */
export function deserializeAgentCard(json: string): A2AAgentCard {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(
      `Invalid Agent Card JSON: ${error instanceof Error ? error.message : 'unknown parse error'}`,
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Agent Card must be a JSON object');
  }
  const obj = parsed as Record<string, unknown>;
  for (const required of [
    'id',
    'name',
    'description',
    'version',
    'capabilities',
    'skills',
    'authentication',
    'endpoints',
  ] as const) {
    if (!(required in obj)) {
      throw new Error(`Agent Card missing required field: ${required}`);
    }
  }
  return freezeDeep(obj) as unknown as A2AAgentCard;
}

/**
 * Canonical JSON — keys sorted recursively, no whitespace.
 *
 * Required so that signing/verification is reproducible across agents and
 * languages. Without this two correct serialisers could disagree on key
 * order and signatures would not verify.
 */
function canonicalStringify(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(',')}]`;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts = keys.map((k) => {
      const v = obj[k];
      if (v === undefined) return null;
      return `${JSON.stringify(k)}:${canonicalStringify(v)}`;
    });
    return `{${parts.filter((p): p is string => p !== null).join(',')}}`;
  }
  return JSON.stringify(value);
}
