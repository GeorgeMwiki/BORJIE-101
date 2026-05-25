/**
 * BORJIE AI output guard — Wave-11 AI security hardening.
 *
 * Runs on every LLM response BEFORE it reaches the user. Catches:
 *   - System-prompt leakage (including canary tokens)
 *   - Cross-tenant PII (phone / NIDA / email / card) leaking out of context
 *   - Disallowed code blocks and external URLs
 *   - API keys, internal paths, tool-execution instructions
 *
 * Redacts where reasonable; blocks when the risk is critical.
 */

import crypto from 'node:crypto';
import { scrubPii } from './pii-scrubber.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OutputIssueType =
  | 'system_prompt_leak'
  | 'api_key_exposure'
  | 'internal_path_exposure'
  | 'cross_tenant_pii'
  | 'code_block_injection'
  | 'hallucinated_url'
  | 'canary_leak'
  | 'metadata_leak';

export type OutputSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface OutputIssue {
  readonly type: OutputIssueType;
  readonly severity: OutputSeverity;
  readonly description: string;
  readonly sample?: string;
}

export interface OutputGuardResult {
  readonly safe: boolean;
  readonly issues: readonly OutputIssue[];
  readonly sanitized: string;
  readonly blocked: boolean;
}

export interface OutputGuardOptions {
  /** Tokens that MUST NOT appear in output. E.g. canary tokens. */
  readonly forbiddenTokens?: readonly string[];
  /** Allow-list of hostnames; everything else is flagged. */
  readonly allowedHostnames?: readonly string[];
  /** When true, all fenced code blocks are stripped (they are not required). */
  readonly stripCodeBlocks?: boolean;
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT_RX: readonly RegExp[] = [
  /you\s+are\s+BORJIE\s+AI.*?system\s+prompt/i,
  /my\s+(system\s+)?instructions\s+(are|say|tell)/i,
  /here\s+(?:are|is)\s+my\s+(system\s+)?prompt/i,
  /SYSTEM_INSTRUCTIONS_/i,
  /UNTRUSTED_USER_INPUT_/i,
  /TOOL_DATA_NOT_INSTRUCTIONS_/i,
  /INJECTION_RESISTANCE_INSTRUCTION/i,
];

const SECRET_RX: readonly RegExp[] = [
  /sk-[A-Za-z0-9]{20,}/,
  /sk-ant-api[A-Za-z0-9-]{20,}/,
  /sk-proj-[A-Za-z0-9]{20,}/,
  /eyJhbGciOi[A-Za-z0-9._-]{50,}/,
  /ANTHROPIC_API_KEY/i,
  /OPENAI_API_KEY/i,
  /BORJIE_SECRET/i,
  /DATABASE_URL\s*=\s*/i,
  /postgres:\/\/[^\s]+/i,
];

const INTERNAL_PATH_RX: readonly RegExp[] = [
  /\/Users\/[A-Za-z]+\//,
  /\/home\/[A-Za-z]+\//,
  /C:\\Users\\/i,
  /packages\/ai-copilot\/src\//,
  /services\/domain-services\//,
  /\.env(\.\w+)?/,
];

const URL_RX = /https?:\/\/[^\s<>"')\]]+/gi;

const CODE_BLOCK_RX = /```[\s\S]*?```/g;

const METADATA_RX: readonly RegExp[] = [
  /<!--\s*SENTIMENT:.*?-->/g,
  /<!--\s*TOOL:.*?-->/g,
  /<!--\s*MODE:.*?-->/g,
];

// ---------------------------------------------------------------------------
// Main guard
// ---------------------------------------------------------------------------

export function scanOutput(
  response: string,
  options: OutputGuardOptions = {},
): OutputGuardResult {
  const issues: OutputIssue[] = [];
  let sanitized = response ?? '';
  let blocked = false;

  // Canary / forbidden tokens — immediate block.
  const forbidden = options.forbiddenTokens ?? [];
  for (const token of forbidden) {
    if (!token) continue;
    if (sanitized.includes(token) || sanitized.toLowerCase().includes(token.toLowerCase())) {
      issues.push({
        type: 'canary_leak',
        severity: 'critical',
        description: 'Canary/forbidden token surfaced in output',
      });
      blocked = true;
      sanitized = SAFE_FALLBACK;
      return freeze({ issues, sanitized, blocked });
    }
  }

  // System-prompt leakage — immediate block.
  for (const rx of SYSTEM_PROMPT_RX) {
    if (rx.test(sanitized)) {
      issues.push({
        type: 'system_prompt_leak',
        severity: 'critical',
        description: 'Output appears to contain system-prompt content',
      });
      blocked = true;
      sanitized = SAFE_FALLBACK;
      return freeze({ issues, sanitized, blocked });
    }
  }

  // Secret exposure — redact.
  for (const rx of SECRET_RX) {
    const match = sanitized.match(rx);
    if (match) {
      // Round-3 audit C12 fix — the previous code emitted a 6-char
      // prefix (`match[0].slice(0, 6)`) into the audit `sample`
      // field, which for an OpenAI `sk-proj-` key reveals the
      // project-id structure. We now emit a SHA-256-truncated digest
      // so analysts can correlate repeated leaks without exposing
      // recoverable key material.
      const digest = crypto
        .createHash('sha256')
        .update(match[0])
        .digest('hex')
        .slice(0, 12);
      issues.push({
        type: 'api_key_exposure',
        severity: 'critical',
        description: 'Output contains an API key or secret',
        sample: `sha256:${digest}…`,
      });
      sanitized = sanitized.replace(
        new RegExp(rx.source, rx.flags.includes('g') ? rx.flags : `${rx.flags}g`),
        '[REDACTED]',
      );
    }
  }

  // Internal paths — redact.
  for (const rx of INTERNAL_PATH_RX) {
    const match = sanitized.match(rx);
    if (match) {
      issues.push({
        type: 'internal_path_exposure',
        severity: 'medium',
        description: 'Output contains internal file system paths',
        sample: match[0],
      });
      sanitized = sanitized.replace(
        new RegExp(rx.source, rx.flags.includes('g') ? rx.flags : `${rx.flags}g`),
        '[internal path]',
      );
    }
  }

  // Round-3 audit M2 fix — metadata markers stripped BEFORE the URL
  // allow-list check. A metadata comment that embedded an allow-listed
  // URL inside an HTML comment previously slipped the allow-list
  // filter because the comment was still present at URL-check time.
  for (const rx of METADATA_RX) {
    if (rx.test(sanitized)) {
      issues.push({
        type: 'metadata_leak',
        severity: 'low',
        description: 'Output contains internal metadata comment',
      });
      sanitized = sanitized.replace(rx, '');
    }
  }

  // URL hostname checking.
  const allowedHostnames = options.allowedHostnames ?? [];
  if (allowedHostnames.length > 0) {
    const hits = sanitized.match(URL_RX) ?? [];
    const bad = hits.filter((u) => {
      try {
        const host = new URL(u).hostname.toLowerCase();
        return !allowedHostnames.some((a) => host.endsWith(a.toLowerCase()));
      } catch {
        return true;
      }
    });
    if (bad.length > 0) {
      issues.push({
        type: 'hallucinated_url',
        severity: 'medium',
        description: `Output contains ${bad.length} URL(s) outside allow-list`,
        sample: bad.slice(0, 3).join(', '),
      });
    }
  }

  // Optional strip of fenced code blocks.
  if (options.stripCodeBlocks && CODE_BLOCK_RX.test(sanitized)) {
    issues.push({
      type: 'code_block_injection',
      severity: 'high',
      description: 'Fenced code block stripped from output',
    });
    sanitized = sanitized.replace(CODE_BLOCK_RX, '[code removed]');
  }

  // Second-pass PII sweep — catches PII that leaked from tool results.
  const piiSweep = scrubPii(sanitized);
  if (piiSweep.hasPii) {
    issues.push({
      type: 'cross_tenant_pii',
      severity: 'high',
      description: `Output contained ${piiSweep.piiFound.length} PII token(s) — redacted`,
    });
    sanitized = piiSweep.scrubbed;
  }

  const hasCritical = issues.some((i) => i.severity === 'critical');
  const hasHigh = issues.some((i) => i.severity === 'high');

  return freeze({ issues, sanitized, blocked: hasCritical || blocked, safe: !hasCritical && !hasHigh });
}

// ---------------------------------------------------------------------------
// Tool-call validator (parity with LitFin)
// ---------------------------------------------------------------------------

export function validateToolCallSafety(
  toolName: string,
  input: Readonly<Record<string, unknown>>,
): { readonly safe: boolean; readonly reason?: string } {
  if (toolName === 'navigate-user') {
    const route = input.route as string | undefined;
    if (route && (route.startsWith('http') || route.startsWith('//'))) {
      return { safe: false, reason: 'external_navigation_blocked' };
    }
  }
  if (toolName === 'fill-form') {
    const value = String(input.value ?? '');
    if (/<script/i.test(value) || /javascript:/i.test(value) || /on\w+\s*=/i.test(value)) {
      return { safe: false, reason: 'xss_detected' };
    }
  }
  if (toolName.startsWith('query-')) {
    const json = JSON.stringify(input);
    if (/;\s*(drop|delete|truncate|alter|update|insert)\s/i.test(json)) {
      return { safe: false, reason: 'sql_injection_detected' };
    }
  }
  return { safe: true };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const SAFE_FALLBACK =
  'I am here to help with property management. How can I assist you today?';

function freeze(
  value: Omit<OutputGuardResult, 'safe'> & { safe?: boolean },
): OutputGuardResult {
  const safe =
    value.safe ??
    (!value.blocked && !value.issues.some((i) => i.severity === 'critical' || i.severity === 'high'));
  return Object.freeze({
    safe,
    issues: Object.freeze([...value.issues]),
    sanitized: value.sanitized,
    blocked: value.blocked,
  });
}
