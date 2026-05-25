/**
 * Intent Verifier — rule-based pre-flight check on proposed tool calls.
 *
 * Catches misaligned/malicious tool arguments before they reach the
 * dispatch layer. Ported from LITFIN
 * `src/core/security/intent-verifier.ts` (Layer A only — the LLM judge
 * "Layer B" is left as a follow-up; the LITFIN port retains its full
 * `LlmCallFn` plug shape for a future drop-in).
 *
 * Three rule families ported in this round:
 *   - SQL injection patterns in tool args (`;\s*(drop|delete|...)`)
 *   - Data-exfiltration destinations (webhook.site, ngrok, requestbin…)
 *   - Prompt-injection-in-args fragments
 *     (`ignore previous`, `system prompt`, `you are now`…)
 *
 * Three additional rules ported for parity:
 *   - Scope-escalation keywords (`all_users`, `service_role`…)
 *   - Cross-tenant access (orgId in args ≠ session orgId)
 *   - Wildcard identifier values (`user_id: "*"`, `org_id: "all"`)
 *
 * Pure function. No I/O. Returns immediately on the first matching rule.
 *
 * Research: `.audit/litfin-sota-2026-05-23/03-security-governance.md`
 * (SC-08, intent-verifier as NemoClaw-equivalent dual-layer).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Verification input — the proposed tool call + the user/session frame. */
export interface IntentVerification {
  readonly toolName: string;
  readonly toolArgs: Readonly<Record<string, unknown>>;
  readonly userMessage: string;
  readonly sessionContext: SessionContext;
}

/** Per-session frame the verifier needs for context-aware rules. */
export interface SessionContext {
  readonly recentTools: ReadonlyArray<string>;
  readonly recentTopics: ReadonlyArray<string>;
  readonly escalationCount: number;
  readonly orgId?: string;
  readonly tenantId?: string;
  readonly userId?: string;
}

/** Verifier verdict shape. */
export interface IntentVerdict {
  readonly permitted: boolean;
  readonly confidence: number;
  readonly layer: 'rule';
  readonly classification: IntentClassification;
  readonly reason: string;
  readonly matchedRule?: string;
}

/** Default classification attached to each verdict. */
export interface IntentClassification {
  readonly sensitivity: 'low' | 'medium' | 'high' | 'critical';
  readonly reversibility:
    | 'reversible'
    | 'partially_reversible'
    | 'irreversible';
  readonly scope: 'single_record' | 'user_scoped' | 'org_scoped' | 'global';
}

// ---------------------------------------------------------------------------
// Pattern banks
// ---------------------------------------------------------------------------

/** SQL injection with destructive statement after a semicolon. */
const SQL_INJECTION_PATTERN =
  /;\s*(drop|delete|truncate|alter|update|insert)\s/i;

/**
 * Standalone destructive SQL operations. Tail anchors handle both raw
 * end-of-string AND JSON-stringified arg values (where the closing
 * quote terminates the SQL fragment).
 */
const SQL_DESTRUCTIVE_STANDALONE =
  /\b(drop\s+table\s+\w+|drop\s+database\s+\w+|truncate\s+table\s+\w+|delete\s+from\s+\w+)(\s*[;"']|\s*$)/i;

/**
 * Known data-exfiltration receiver endpoints. Extends the LITFIN list
 * verbatim; broaden via PR rather than runtime config so changes get
 * security review.
 */
const EXFIL_ENDPOINTS: ReadonlyArray<RegExp> = [
  /webhook\.site/i,
  /requestbin/i,
  /ngrok\.io/i,
  /ngrok\.app/i,
  /pipedream/i,
  /hookbin/i,
  /beeceptor/i,
  /postb\.in/i,
  /requestcatcher/i,
  /burpcollaborator/i,
  /interact\.sh/i,
  /oastify\.com/i,
  /canarytokens\.com/i,
];

/**
 * Prompt-injection fragments smuggled into tool arguments. The model
 * may emit these when compromised by an indirect prompt injection in
 * an earlier tool output.
 */
const PROMPT_INJECTION_IN_ARGS: ReadonlyArray<RegExp> = [
  /ignore\s+(all\s+)?previous/i,
  /system\s+prompt/i,
  /you\s+are\s+now/i,
  /forget\s+(all\s+)?(your|the)\s+(rules|instructions)/i,
  /disregard\s+(all\s+)?(your|the|prior)/i,
  /override\s+(your|the|system)/i,
  /new\s+instructions?\s*:/i,
  /ADMIN\s+OVERRIDE/i,
  /\[INST\]/i,
  /<\|im_start\|>/i,
];

/** Scope-escalation keywords in args (tool trying to widen its blast radius). */
const SCOPE_ESCALATION_PATTERNS: ReadonlyArray<RegExp> = [
  /\ball_users\b/i,
  /\ball_org(anization)?s?\b/i,
  /\ball_tenants?\b/i,
  /\badmin_override\b/i,
  /\bsuper_?admin\b/i,
  /\bbypass_?auth\b/i,
  /\bservice_role\b/i,
  /\broot_?access\b/i,
];

/** Overly broad SELECT * queries (matches inside JSON-stringified args). */
const BROAD_QUERY_PATTERNS: ReadonlyArray<RegExp> = [
  // bare end of input
  /select\s+\*\s+from\s+\w+\s*$/i,
  // ends with statement-terminator
  /select\s+\*\s+from\s+\w+\s*;/i,
  // ends with JSON-string-close quote
  /select\s+\*\s+from\s+\w+\s*"/i,
];

// ---------------------------------------------------------------------------
// Rule pattern table
// ---------------------------------------------------------------------------

interface RulePattern {
  readonly name: string;
  readonly test: (req: IntentVerification) => boolean;
  readonly classification: IntentClassification;
  readonly reason: string;
}

const RULE_PATTERNS: ReadonlyArray<RulePattern> = [
  // --- SQL injection ------------------------------------------------------
  {
    name: 'sql_injection_semicolon',
    test: (req) =>
      SQL_INJECTION_PATTERN.test(JSON.stringify(req.toolArgs)),
    classification: {
      sensitivity: 'critical',
      reversibility: 'irreversible',
      scope: 'global',
    },
    reason:
      'Tool arguments contain SQL injection pattern (destructive statement after semicolon)',
  },
  {
    name: 'sql_destructive_standalone',
    test: (req) =>
      SQL_DESTRUCTIVE_STANDALONE.test(JSON.stringify(req.toolArgs)),
    classification: {
      sensitivity: 'critical',
      reversibility: 'irreversible',
      scope: 'global',
    },
    reason: 'Tool arguments contain standalone destructive SQL operation',
  },

  // --- Scope escalation ---------------------------------------------------
  {
    name: 'scope_escalation',
    test: (req) =>
      SCOPE_ESCALATION_PATTERNS.some((p) =>
        p.test(JSON.stringify(req.toolArgs)),
      ),
    classification: {
      sensitivity: 'critical',
      reversibility: 'reversible',
      scope: 'global',
    },
    reason:
      'Tool arguments contain scope-escalation keyword (all_users / admin_override / service_role…)',
  },

  // --- Data exfiltration -------------------------------------------------
  {
    name: 'data_exfiltration_endpoint',
    test: (req) =>
      EXFIL_ENDPOINTS.some((p) => p.test(JSON.stringify(req.toolArgs))),
    classification: {
      sensitivity: 'critical',
      reversibility: 'irreversible',
      scope: 'global',
    },
    reason:
      'Tool arguments reference a known data-exfiltration endpoint (webhook.site / ngrok / requestbin / …)',
  },

  // --- Prompt injection in args -----------------------------------------
  {
    name: 'prompt_injection_in_args',
    test: (req) =>
      PROMPT_INJECTION_IN_ARGS.some((p) =>
        p.test(JSON.stringify(req.toolArgs)),
      ),
    classification: {
      sensitivity: 'high',
      reversibility: 'reversible',
      scope: 'user_scoped',
    },
    reason: 'Tool arguments contain prompt-injection fragments',
  },

  // --- Overly broad queries ---------------------------------------------
  {
    name: 'overly_broad_query',
    test: (req) => {
      if (!req.toolName.startsWith('query-')) return false;
      const argsStr = JSON.stringify(req.toolArgs);
      if (BROAD_QUERY_PATTERNS.some((p) => p.test(argsStr))) return true;
      const filters =
        req.toolArgs.filters ?? req.toolArgs.filter ?? req.toolArgs.where;
      if (filters !== undefined && filters !== null) {
        if (
          typeof filters === 'object' &&
          Object.keys(filters as object).length === 0
        ) {
          return true;
        }
      }
      return false;
    },
    classification: {
      sensitivity: 'high',
      reversibility: 'reversible',
      scope: 'org_scoped',
    },
    reason:
      'Query tool called with overly broad parameters (no WHERE clause or empty filters)',
  },

  // --- Wildcard identifier (runs BEFORE cross-tenant so "*"/"all" land
  //     in the wildcard bucket rather than as a cross-tenant mismatch) -
  {
    name: 'wildcard_identifier',
    test: (req) => {
      const identifierKeys = [
        'user_id',
        'userId',
        'org_id',
        'orgId',
        'organization_id',
        'organizationId',
        'tenant_id',
        'tenantId',
        'landlord_id',
        'landlordId',
        'property_id',
        'propertyId',
      ];
      for (const key of identifierKeys) {
        const value = req.toolArgs[key];
        if (typeof value === 'string') {
          const lower = value.toLowerCase().trim();
          if (
            lower === '*' ||
            lower === 'all' ||
            lower === 'any' ||
            lower === '%'
          ) {
            return true;
          }
        }
      }
      return false;
    },
    classification: {
      sensitivity: 'critical',
      reversibility: 'reversible',
      scope: 'global',
    },
    reason: 'Tool arguments use wildcard value in an identifier field',
  },

  // --- Cross-tenant access ----------------------------------------------
  {
    name: 'cross_tenant_access',
    test: (req) => {
      const sessionOrg =
        req.sessionContext.orgId ?? req.sessionContext.tenantId;
      if (!sessionOrg) return false;
      const values = extractTenantIdValues(req.toolArgs);
      return values.some((val) => val !== sessionOrg && val.length > 0);
    },
    classification: {
      sensitivity: 'critical',
      reversibility: 'reversible',
      scope: 'global',
    },
    reason:
      'Tool arguments reference an organization/tenant ID different from the current session',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Recursively collect any tenant/org-id-shaped values from nested args. */
function extractTenantIdValues(
  obj: Readonly<Record<string, unknown>>,
  collected: string[] = [],
): ReadonlyArray<string> {
  const orgKeys = new Set([
    'org_id',
    'orgId',
    'organization_id',
    'organizationId',
    'tenant_id',
    'tenantId',
    'landlord_id',
    'landlordId',
  ]);

  for (const [key, value] of Object.entries(obj)) {
    if (orgKeys.has(key) && typeof value === 'string') {
      collected.push(value);
    }
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      extractTenantIdValues(value as Record<string, unknown>, collected);
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== null && typeof item === 'object') {
          extractTenantIdValues(
            item as Record<string, unknown>,
            collected,
          );
        }
      }
    }
  }

  return collected;
}

function defaultClassificationFor(toolName: string): IntentClassification {
  if (toolName.startsWith('query-')) {
    return {
      sensitivity: 'medium',
      reversibility: 'reversible',
      scope: 'org_scoped',
    };
  }
  if (toolName.startsWith('delete-') || toolName.startsWith('disburse-')) {
    return {
      sensitivity: 'critical',
      reversibility: 'irreversible',
      scope: 'org_scoped',
    };
  }
  if (toolName.startsWith('navigate') || toolName === 'switch-tab') {
    return {
      sensitivity: 'low',
      reversibility: 'reversible',
      scope: 'user_scoped',
    };
  }
  return {
    sensitivity: 'medium',
    reversibility: 'reversible',
    scope: 'user_scoped',
  };
}

// ---------------------------------------------------------------------------
// Main export: verifyIntent
// ---------------------------------------------------------------------------

/**
 * Verify a proposed tool call against the rule bank. Pure function.
 *
 * Returns:
 *   - `{ permitted: false, … }` on first matching rule. Confidence is
 *     0.98 (rule matches are strong but not infallible — the args might
 *     be a literal string in a benign domain object).
 *   - `{ permitted: true, … }` when no rule fires. Confidence 0.95.
 *     The caller is free to layer an LLM judge (Layer B) on top —
 *     intentionally out of scope for this round.
 */
export function verifyIntent(req: IntentVerification): IntentVerdict {
  for (const rule of RULE_PATTERNS) {
    try {
      if (rule.test(req)) {
        return Object.freeze({
          permitted: false,
          confidence: 0.98,
          layer: 'rule' as const,
          classification: rule.classification,
          reason: `[${rule.name}] ${rule.reason}`,
          matchedRule: rule.name,
        });
      }
    } catch {
      // Per-rule failure must not block the pipeline. Skip and continue.
    }
  }

  return Object.freeze({
    permitted: true,
    confidence: 0.95,
    layer: 'rule' as const,
    classification: defaultClassificationFor(req.toolName),
    reason: 'No violations detected by rule-based analysis',
  });
}

/**
 * Verify a batch of proposed tool calls in the order received. Stops
 * (and short-circuits the remainder to a generic deny) at the first
 * violation, matching the LITFIN behaviour where one bad tool in a
 * batch aborts the whole turn.
 */
export function verifyIntentBatch(
  requests: ReadonlyArray<IntentVerification>,
): ReadonlyArray<IntentVerdict> {
  const verdicts: IntentVerdict[] = [];

  for (let i = 0; i < requests.length; i++) {
    const current = requests[i];
    if (current === undefined) continue;
    const verdict = verifyIntent(current);
    verdicts.push(verdict);
    if (!verdict.permitted) {
      for (let j = i + 1; j < requests.length; j++) {
        const skipped = requests[j];
        if (skipped === undefined) continue;
        verdicts.push(
          Object.freeze({
            permitted: false,
            confidence: 1.0,
            layer: 'rule' as const,
            classification: defaultClassificationFor(skipped.toolName),
            reason: 'Skipped: a prior tool call in this batch was denied',
            matchedRule: 'batch_short_circuit',
          }),
        );
      }
      break;
    }
  }

  return Object.freeze(verdicts);
}
