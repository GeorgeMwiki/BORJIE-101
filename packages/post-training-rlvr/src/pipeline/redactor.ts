/**
 * PII redactor — replace every leaf value in a trace with a salted-hash
 * placeholder: `sha256(tenantId:fieldPath:value)`. This is the salted-
 * hash pattern from Wave 18R deep research.
 *
 * The salt is the tenant ID — the same plaintext under two tenants
 * produces different hashes, defeating cross-tenant correlation.
 *
 * Allow-list fields stay in plaintext (regulation section IDs, mineral
 * kinds, royalty percentages). Anything not on the allow-list is
 * hashed by default — fail-closed.
 */

import { createHash } from 'node:crypto';
import type { RedactionConfig, RlvrTrace } from '../types.js';

const PREFIX = 'rlvr-hash:';

function saltedHash(
  tenantId: string,
  fieldPath: string,
  value: unknown,
): string {
  const serialised =
    typeof value === 'string' ? value : JSON.stringify(value);
  const hash = createHash('sha256')
    .update(`${tenantId}:${fieldPath}:${serialised}`)
    .digest('hex');
  return `${PREFIX}${hash.slice(0, 32)}`;
}

function pathMatches(
  path: string,
  allowlist: ReadonlyArray<string>,
): boolean {
  return allowlist.some((p) => p === path || path.startsWith(`${p}.`));
}

function redactValue(
  value: unknown,
  path: string,
  config: RedactionConfig,
): unknown {
  if (pathMatches(path, config.allowlist)) {
    return value;
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, idx) =>
      redactValue(item, `${path}[${idx}]`, config),
    );
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactValue(v, path === '' ? k : `${path}.${k}`, config);
    }
    return out;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return saltedHash(config.tenantId, path, value);
  }
  return saltedHash(config.tenantId, path, String(value));
}

/**
 * Redact a trace. The returned object is a deep clone — the input is
 * not mutated.
 */
export function redactTrace(
  trace: RlvrTrace,
  config: RedactionConfig,
): RlvrTrace {
  const prompt = redactValue(
    trace.prompt,
    'prompt',
    config,
  ) as string;
  const completion = redactValue(
    trace.completion,
    'completion',
    config,
  ) as string;
  const toolCalls = trace.toolCalls.map((tc, idx) =>
    Object.freeze({
      name: tc.name,
      args: redactValue(
        tc.args,
        `toolCalls[${idx}].args`,
        config,
      ) as Record<string, unknown>,
      result:
        tc.result === null
          ? null
          : (redactValue(
              tc.result,
              `toolCalls[${idx}].result`,
              config,
            ) as Record<string, unknown>),
    }),
  );
  const metadata = redactValue(
    trace.metadata,
    'metadata',
    config,
  ) as Record<string, unknown>;

  return Object.freeze({
    id: trace.id,
    runId: trace.runId,
    tenantId: trace.tenantId,
    prompt,
    completion,
    toolCalls: Object.freeze(toolCalls),
    metadata: Object.freeze(metadata),
    capturedAt: trace.capturedAt,
  });
}

/**
 * Test helper — confirms `redactedTrace` contains none of the
 * plaintext values in `secrets`. Returns the list of leaked secrets;
 * an empty array means the redaction was complete.
 */
export function findLeakedSecrets(
  redactedTrace: RlvrTrace,
  secrets: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const haystack = JSON.stringify(redactedTrace);
  return secrets.filter((s) => haystack.includes(s));
}
