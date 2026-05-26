/**
 * Output filter (LLM02 + LLM05 + LLM07).
 *
 * Sanitises agent outputs before they reach the user / a tool / the
 * persistence layer. Rules:
 *
 *   - markdown-image-suspicious-domain — strip `![alt](url)` whose host
 *     is not in the allow-list. This is the canonical defense against
 *     the Rehberger 2023 Markdown-image data-exfil attack.
 *   - pii-redact — delegates to the injected `DataProtectionPort`.
 *   - system-prompt-leak — regex on canonical persona system prompts.
 *   - code-execution-attempt — strip eval/Function/child_process refs.
 *   - js-injection-tag — strip `<script>`/`<iframe>`/event handlers.
 *   - cross-tenant-id-leak — strip stray tenant-id values that don't
 *     match the configured tenant.
 *
 * Each block produces an `OutputFilterBlock` row (hash-chained).
 */
import { rowHash } from '../audit/hash-chain.js';
import type {
  AgentChannel,
  OutputFilterBlock,
  OutputFilterResult,
  OutputFilterRule,
} from '../types.js';

const MARKDOWN_IMAGE_REGEX = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;
const SYSTEM_PROMPT_LEAK_REGEXES: ReadonlyArray<RegExp> = Object.freeze([
  /you\s+are\s+mr\.?\s+mwikila/i,
  /<<<persona>>>/i,
  /system\s+prompt\s*:/i,
  /\[\[BEGIN_PERSONA\]\]/i,
]);
const CODE_EXEC_REGEXES: ReadonlyArray<RegExp> = Object.freeze([
  /\beval\s*\(/i,
  /new\s+Function\s*\(/i,
  /\bchild_process\b/i,
  /\bos\.system\s*\(/i,
]);
const JS_INJECTION_REGEXES: ReadonlyArray<RegExp> = Object.freeze([
  /<script[\s\S]*?<\/script>/gi,
  /<script[^>]*>/gi,
  /<iframe[\s\S]*?<\/iframe>/gi,
  /\son\w+\s*=\s*"[^"]*"/gi,
  /\son\w+\s*=\s*'[^']*'/gi,
]);

/**
 * Port for the PII redactor — production composition wires this to
 * `@borjie/data-protection`. Tests may pass a stub.
 */
export interface DataProtectionPort {
  readonly redactPii: (input: { readonly text: string }) => {
    readonly redacted: string;
    readonly hits: number;
  };
}

export interface OutputFilterDeps {
  readonly tenantId: string;
  readonly channel: AgentChannel;
  readonly allowedImageDomains: ReadonlyArray<string>;
  readonly dataProtection?: DataProtectionPort;
  /** Other tenant ids that, if seen in output, trigger a cross-tenant-leak block. */
  readonly forbiddenTenantIds?: ReadonlyArray<string>;
}

function mkBlock(
  deps: OutputFilterDeps,
  rule: OutputFilterRule,
  excerpt: string,
  nowIso: string,
): OutputFilterBlock {
  const auditHash = rowHash({
    tenantId: deps.tenantId,
    channel: deps.channel,
    rule,
    excerpt,
    blockedAt: nowIso,
  });
  return Object.freeze({
    id: `block-${auditHash.slice(0, 16)}`,
    tenantId: deps.tenantId,
    channel: deps.channel,
    outputExcerpt: excerpt.slice(0, 240),
    filterRule: rule,
    blockedAt: nowIso,
    auditHash,
  });
}

export interface OutputFilter {
  readonly filter: (output: string) => OutputFilterResult;
}

export function createOutputFilter(deps: OutputFilterDeps): OutputFilter {
  const allowedHosts = new Set(
    deps.allowedImageDomains.map((d) => d.toLowerCase()),
  );

  function filter(output: string): OutputFilterResult {
    if (typeof output !== 'string' || output.length === 0) {
      return Object.freeze({
        cleaned: '',
        blocks: Object.freeze([]),
      });
    }

    const blocks: OutputFilterBlock[] = [];
    const nowIso = new Date().toISOString();
    let cleaned = output;

    // (a) Markdown image — suspicious domain
    cleaned = cleaned.replace(MARKDOWN_IMAGE_REGEX, (match, _alt, url) => {
      let host = '';
      try {
        host = new URL(url).hostname.toLowerCase();
      } catch {
        // malformed URL — always block
        blocks.push(
          mkBlock(deps, 'markdown-image-suspicious-domain', match, nowIso),
        );
        return '[IMAGE_REMOVED:MALFORMED_URL]';
      }
      if (!allowedHosts.has(host)) {
        blocks.push(
          mkBlock(deps, 'markdown-image-suspicious-domain', match, nowIso),
        );
        return '[IMAGE_REMOVED:UNALLOWED_DOMAIN]';
      }
      return match;
    });

    // (b) System-prompt leak
    for (const regex of SYSTEM_PROMPT_LEAK_REGEXES) {
      if (regex.test(cleaned)) {
        const m = regex.exec(cleaned);
        const excerpt = m === null ? '' : m[0];
        blocks.push(mkBlock(deps, 'system-prompt-leak', excerpt, nowIso));
        cleaned = cleaned.replace(regex, '[SYSTEM_PROMPT_REDACTED]');
      }
    }

    // (c) Code execution
    for (const regex of CODE_EXEC_REGEXES) {
      if (regex.test(cleaned)) {
        const m = regex.exec(cleaned);
        const excerpt = m === null ? '' : m[0];
        blocks.push(mkBlock(deps, 'code-execution-attempt', excerpt, nowIso));
        // We do NOT remove the surrounding code-fence — we replace the
        // dangerous identifier with a clearly-tagged placeholder so the
        // user still sees the structural context.
        const globalRegex = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`);
        cleaned = cleaned.replace(globalRegex, '[CODE_EXEC_REDACTED]');
      }
    }

    // (d) JS injection tags
    for (const regex of JS_INJECTION_REGEXES) {
      const globalRegex = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`);
      let found = false;
      let firstMatch = '';
      cleaned = cleaned.replace(globalRegex, (m) => {
        if (!found) {
          found = true;
          firstMatch = m;
        }
        return '[JS_TAG_REDACTED]';
      });
      if (found) {
        blocks.push(mkBlock(deps, 'js-injection-tag', firstMatch, nowIso));
      }
    }

    // (e) Cross-tenant-id leak
    if (deps.forbiddenTenantIds !== undefined) {
      for (const otherTenant of deps.forbiddenTenantIds) {
        if (otherTenant.length === 0) continue;
        const escaped = otherTenant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\b${escaped}\\b`, 'g');
        if (regex.test(cleaned)) {
          blocks.push(mkBlock(deps, 'cross-tenant-id-leak', otherTenant, nowIso));
          cleaned = cleaned.replace(regex, '[TENANT_ID_REDACTED]');
        }
      }
    }

    // (f) PII redaction — last, so any new placeholders we inserted
    //     do not themselves match the PII regexes.
    if (deps.dataProtection !== undefined) {
      const piiResult = deps.dataProtection.redactPii({ text: cleaned });
      if (piiResult.hits > 0) {
        blocks.push(
          mkBlock(deps, 'pii-redact', `pii-hits=${piiResult.hits}`, nowIso),
        );
        cleaned = piiResult.redacted;
      }
    }

    return Object.freeze({
      cleaned,
      blocks: Object.freeze(blocks),
    });
  }

  return Object.freeze({ filter });
}
