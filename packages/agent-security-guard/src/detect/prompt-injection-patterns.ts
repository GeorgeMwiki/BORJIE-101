/**
 * Canonical direct-prompt-injection pattern corpus.
 *
 * Sources:
 *   - OWASP LLM01 (2025 revision): https://genai.owasp.org/llm-top-10/
 *   - MITRE ATLAS AML.T0051: https://atlas.mitre.org/
 *   - Greshake et al. 2023 (indirect injection): https://arxiv.org/abs/2302.12173
 *   - Rehberger 2023 (Markdown-image exfil):
 *       https://embracethered.com/blog/posts/2023/markdown-image-prompt-injection-exfil/
 *   - Anil et al. 2024 (many-shot jailbreak): https://arxiv.org/abs/2404.02151
 *   - Wei et al. 2024 (jailbroken taxonomy): https://arxiv.org/abs/2402.06363
 *
 * Each pattern is `readonly` and tagged with a Severity + InjectionKind.
 * Patterns are matched case-insensitively. Long runs of nonsense or
 * fake-turn markers are detected separately by the many-shot heuristic
 * in `jailbreak/jailbreak-detector.ts`.
 */
import type { InjectionKind, Severity } from '../types.js';

export interface PromptInjectionPattern {
  readonly regex: RegExp;
  readonly kind: InjectionKind;
  readonly severity: Severity;
  readonly label: string;
}

/**
 * Build a pattern using a case-insensitive regex by default.
 */
function pat(
  source: string,
  kind: InjectionKind,
  severity: Severity,
  label: string,
): PromptInjectionPattern {
  return Object.freeze({
    regex: new RegExp(source, 'i'),
    kind,
    severity,
    label,
  });
}

/**
 * Direct-injection patterns. Curated to cover canonical attacks from
 * the OWASP / ATLAS / academic-literature corpus referenced above.
 */
export const DIRECT_INJECTION_PATTERNS: ReadonlyArray<PromptInjectionPattern> =
  Object.freeze([
    // ignore-previous-instructions family
    pat(
      'ignore\\s+(?:all\\s+)?(?:previous|prior|above)\\s+(?:instructions?|prompts?|rules?)',
      'ignore-previous-instructions',
      'high',
      'ignore-previous',
    ),
    pat(
      'disregard\\s+(?:the\\s+)?(?:previous|prior|above)\\s+(?:instructions?|prompts?)',
      'ignore-previous-instructions',
      'high',
      'disregard-previous',
    ),
    pat(
      'forget\\s+(?:all\\s+)?(?:previous|prior|earlier)\\s+(?:instructions?|context)',
      'ignore-previous-instructions',
      'high',
      'forget-previous',
    ),
    pat(
      'override\\s+(?:the\\s+)?(?:system|previous)\\s+prompt',
      'ignore-previous-instructions',
      'high',
      'override-prompt',
    ),

    // role-play override
    pat(
      'you\\s+are\\s+now\\s+(?:a|an|the)\\s+',
      'role-play-override',
      'medium',
      'you-are-now',
    ),
    pat(
      'pretend\\s+(?:to\\s+be|you\\s+are)\\s+',
      'role-play-override',
      'medium',
      'pretend-to-be',
    ),
    pat(
      'act\\s+as\\s+(?:if\\s+you\\s+(?:were|are)\\s+)?(?:a|an|the)\\s+',
      'role-play-override',
      'medium',
      'act-as',
    ),
    pat(
      'roleplay\\s+as\\s+',
      'role-play-override',
      'medium',
      'roleplay-as',
    ),
    pat(
      'simulate\\s+(?:being\\s+)?(?:a|an|the)\\s+',
      'role-play-override',
      'medium',
      'simulate-being',
    ),

    // system-prompt extraction
    pat(
      'what\\s+(?:are|is)\\s+(?:your|the)\\s+(?:system\\s+)?(?:prompt|instructions?)',
      'system-prompt-extraction',
      'high',
      'sys-prompt-ask',
    ),
    pat(
      '(?:repeat|show|reveal|print|display|output)\\s+(?:back\\s+)?(?:your|the|my)?\\s*(?:full\\s+|complete\\s+|entire\\s+|original\\s+|initial\\s+|hidden\\s+)?(?:system\\s+)?(?:prompt|instructions?)',
      'system-prompt-extraction',
      'high',
      'sys-prompt-reveal',
    ),
    pat(
      '(?:output|print|show|reveal)\\s+(?:back\\s+)?(?:your|the|my)?\\s*(?:first|initial)\\s+(?:line|prompt)',
      'system-prompt-extraction',
      'high',
      'first-line-leak',
    ),
    pat(
      '\\bhidden\\s+instructions?\\b',
      'system-prompt-extraction',
      'high',
      'hidden-instructions',
    ),
    pat(
      'what\\s+(?:are\\s+)?your\\s+(?:initial|original|hidden)\\s+(?:instructions?|prompts?)',
      'system-prompt-extraction',
      'high',
      'initial-instructions',
    ),

    // code execution request
    pat(
      'execute\\s+(?:the\\s+)?following\\s+code',
      'code-execution-request',
      'critical',
      'exec-code',
    ),
    pat(
      'run\\s+(?:this|the\\s+following)\\s+(?:command|shell|script)',
      'code-execution-request',
      'critical',
      'run-shell',
    ),
    pat(
      'eval\\s*\\(',
      'code-execution-request',
      'high',
      'eval-call',
    ),
    pat(
      'os\\.system\\s*\\(',
      'code-execution-request',
      'critical',
      'os-system',
    ),
    pat(
      'child_process',
      'code-execution-request',
      'critical',
      'child-process',
    ),

    // base64 / encoded injection
    pat(
      'decode\\s+(?:the\\s+following|this)\\s+base64',
      'base64-injection',
      'high',
      'decode-base64',
    ),
    pat(
      'base64:[A-Za-z0-9+/]{40,}={0,2}',
      'base64-injection',
      'medium',
      'base64-blob',
    ),

    // language-switch attack
    pat(
      '(?:in|using)\\s+(?:reverse|backwards|mirror)\\s+(?:order|writing)',
      'language-switch-attack',
      'low',
      'lang-reverse',
    ),
    pat(
      'translate\\s+(?:and\\s+)?execute',
      'language-switch-attack',
      'high',
      'translate-execute',
    ),

    // mid-token / split attack
    pat(
      'ign\\W{0,3}ore\\s+(?:the\\s+)?(?:previous|prior|above)',
      'mid-token-split',
      'high',
      'ignore-split',
    ),
    pat(
      'i.{0,2}g.{0,2}n.{0,2}o.{0,2}r.{0,2}e\\s+previous',
      'mid-token-split',
      'high',
      'ignore-letter-split',
    ),

    // markdown-image exfil request (the Rehberger 2023 vector)
    pat(
      '!\\[[^\\]]*\\]\\(https?:\\/\\/[^\\)]*\\?[^\\)]*=',
      'markdown-image-exfil-request',
      'critical',
      'md-image-exfil',
    ),

    // PII fishing
    pat(
      '(?:list|show|dump)\\s+(?:all\\s+)?(?:users?|customers?|tenants?)',
      'pii-fishing',
      'high',
      'list-users',
    ),
    pat(
      '(?:show|reveal)\\s+(?:all\\s+)?(?:email|phone|ssn|address)',
      'pii-fishing',
      'high',
      'show-pii',
    ),

    // credential extraction
    pat(
      '(?:show|reveal|dump|onyesha|toa)\\s+(?:all\\s+)?(?:api[_-]?keys?|secrets?|tokens?|passwords?)',
      'credential-extraction',
      'critical',
      'show-credentials',
    ),
    pat(
      '\\b(?:all\\s+)?(?:api[_-]?keys?|secrets?|tokens?|passwords?)\\b.*\\b(?:dump|exfil|export|exfiltrate)\\b',
      'credential-extraction',
      'critical',
      'cred-exfil',
    ),
    pat(
      '\\ball\\s+api[_-]?keys?\\b',
      'credential-extraction',
      'high',
      'all-api-keys',
    ),
    pat(
      'process\\.env',
      'env-dump-request',
      'high',
      'env-ref',
    ),
    pat(
      '(?:list|show|dump)\\s+(?:all\\s+)?environment\\s+variables?',
      'env-dump-request',
      'critical',
      'env-dump',
    ),

    // cross-tenant fishing
    pat(
      '(?:other|another|different)\\s+tenant',
      'cross-tenant-fishing',
      'high',
      'other-tenant',
    ),
    pat(
      'switch\\s+to\\s+tenant',
      'cross-tenant-fishing',
      'critical',
      'switch-tenant',
    ),
    pat(
      'set\\s+tenant[_-]?id\\s*=',
      'cross-tenant-fishing',
      'critical',
      'set-tenant-id',
    ),
  ]);

/**
 * Indirect-injection (retrieved doc / tool output) patterns. Each
 * triggers content-stripping rather than rejection so that the
 * surrounding doc remains usable.
 */
export const INDIRECT_INJECTION_PATTERNS: ReadonlyArray<PromptInjectionPattern> =
  Object.freeze([
    pat(
      '<!--[^>]*\\b(?:ignore|disregard|system|assistant|ai)\\b[^>]*-->',
      'indirect-html-comment',
      'high',
      'html-comment-instruction',
    ),
    pat(
      '<style[^>]*>[^<]*display\\s*:\\s*none[^<]*</style>',
      'indirect-hidden-css',
      'medium',
      'hidden-css',
    ),
    pat(
      '<script[^>]*>',
      'indirect-hidden-css',
      'critical',
      'script-tag',
    ),
    pat(
      '\\bAI\\s*:\\s*ignore',
      'indirect-retrieved-doc',
      'high',
      'ai-ignore-marker',
    ),
    pat(
      '\\bAssistant\\s*:\\s*(?:ignore|override|now)',
      'indirect-retrieved-doc',
      'high',
      'assistant-marker',
    ),
    pat(
      '\\bSYSTEM\\s*:\\s*new\\s+instructions',
      'indirect-retrieved-doc',
      'high',
      'system-marker',
    ),
  ]);

/**
 * Zero-width and bidirectional characters used for hidden payloads.
 * U+200B, U+200C, U+200D (ZWSP/ZWNJ/ZWJ) + U+FEFF (BOM) + U+202E (RTL).
 */
export const ZERO_WIDTH_REGEX = /[​‌‍﻿‮]/u;
