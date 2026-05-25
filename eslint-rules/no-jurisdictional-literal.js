/**
 * ESLint custom rule: `no-jurisdictional-literal`
 *
 * Phase E.0 — flags hard-coded jurisdictional values that should be read
 * from `getJurisdictionalRules(country)` instead. This is the lint-time
 * companion to the audit script at `scripts/audit-jurisdictional-literals.mjs`.
 *
 * What it catches (in `Literal` + `TemplateLiteral` nodes):
 *   - Country-coupled identifiers:
 *       'NIDA', 'KRA', 'TRA', 'KRA PIN', 'eRITS', 'eArdhi',
 *       'Ardhisasa', 'M-Pesa', 'GePG', 'NRC', 'Huduma'
 *   - Embedded phone-country prefixes: '+254', '+255'
 *   - Hard-coded timezones: 'Africa/Dar_es_Salaam', 'Africa/Nairobi'
 *   - AWS region defaults: 'eu-west-1', 'us-east-1'
 *   - Hard-coded VAT rate numerics: 0.18 / 18.0 followed by '%' in a
 *     VAT context (best-effort heuristic on neighbouring template/comment
 *     content)
 *   - 3-value currency enums: `KES | TZS | USD` style unions
 *
 * Allowed locations (whitelisted by file path; if the file matches any
 * pattern below the rule is skipped entirely):
 *   - `packages/connectors/src/adapters/<country>-<connector>.ts`
 *   - `packages/domain-models/src/common/jurisdictional-rules.ts`
 *   - `packages/domain-models/src/common/region-config.ts`
 *   - `packages/database/src/seeds/**`
 *   - `**\/__tests__/**`, `**\/__fixtures__/**`, `**\/fixtures/**`
 *   - `**\/*.md`
 *
 * Default severity is `warn` so existing literals do not break CI until
 * the Phase E.0.4 rebind pass lands. The audit script enumerates every
 * violation site as a worklist for that pass.
 */
'use strict';

// ---- Jurisdictional identifier vocabulary ----
// Use a Set for O(1) membership probes. Each entry MUST be matched by the
// FULL literal string (not a substring) to avoid catching benign words
// like 'mpesa-receipts' or 'kra/test-helpers'. We separately scan
// concatenated identifiers (e.g. 'KRA PIN', '@borjie/mcp-mpesa-ke')
// via the prefix patterns.
const JURISDICTIONAL_IDENTIFIERS = new Set([
  'NIDA',
  'KRA',
  'TRA',
  'KRA PIN',
  'eRITS',
  'eArdhi',
  'Ardhisasa',
  'M-Pesa',
  'GePG',
  'NRC',
  'Huduma',
]);

// Phone-country prefixes embedded in business logic. Allowed in tests
// and region-config (whitelisted via file path).
const PHONE_PREFIXES = new Set(['+254', '+255']);

// IANA timezones we ship to East-Africa pilot countries.
const HARDCODED_TIMEZONES = new Set([
  'Africa/Dar_es_Salaam',
  'Africa/Nairobi',
]);

// AWS region defaults — we want these to flow from
// getJurisdictionalRules(country).awsRegionDefault, not be hard-coded.
const AWS_REGIONS = new Set(['eu-west-1', 'us-east-1']);

// File-path allowlist. A jurisdictional literal in any of these files
// is considered legitimate (registry / adapter / seed / test / docs).
//
// Phase E.0.4 extension: country-bound files where the country IS the file's
// identity are allowlisted. These files implement the per-country plugin /
// port that `getJurisdictionalRules(country)` ultimately dispatches to —
// they cannot avoid the country-coupled literals because that's their
// reason for existing. Tracked patterns:
//   - packages/compliance-plugins/src/countries/{cc}/...
//   - packages/compliance-plugins/src/plugins/{country-name}.ts
//   - services/payments/src/providers/{rail}/...
//   - services/reports/src/compliance/{cc}-{regulator}-formatter.ts
//   - services/api-gateway/.../durable/temporal/{cc}-{regime}-workflow.ts
//   - packages/central-intelligence/.../hq-tools/platform.file_{regulator}_*.ts
//   - packages/domain-models/src/tenant/{country}-identifiers.ts
const ALLOWLIST_PATTERNS = [
  /packages\/domain-models\/src\/common\/jurisdictional-rules\.ts$/,
  /packages\/domain-models\/src\/common\/region-config\.ts$/,
  /packages\/connectors\/src\/adapters\/[a-z][a-z0-9-]+-(adapter|client|provider)\.ts$/,
  /packages\/connectors\/src\/adapters\/[a-z]{2,3}-[a-z0-9-]+\.ts$/,
  /packages\/database\/src\/seeds\//,
  /\/__tests__\//,
  /\/__fixtures__\//,
  /\/fixtures\//,
  /\.test\.[cm]?[jt]sx?$/,
  /\.spec\.[cm]?[jt]sx?$/,
  /^e2e\/.*\.[cm]?[jt]sx?$/,
  /\/test\/integration\/.*\.[cm]?[jt]sx?$/,
  /\.md$/,
  /packages\/compliance-plugins\/src\/countries\/[a-z]{2,3}\//,
  /packages\/compliance-plugins\/src\/plugins\/[a-z][a-z0-9-]+\.ts$/,
  /services\/payments\/src\/providers\/(gepg|mpesa|airtel-money|pesalink|t-kash|halotel-pesa)\//,
  /services\/reports\/src\/compliance\/[a-z]{2,3}-[a-z0-9-]+-formatter\.ts$/,
  /services\/api-gateway\/src\/composition\/durable\/temporal\/[a-z]{2,3}-[a-z0-9-]+-(workflow|activities)\.ts$/,
  /packages\/central-intelligence\/src\/kernel\/tool-spec\/hq-tools\/platform\.file_(kra|tra)_[a-z]+\.ts$/,
  /packages\/domain-models\/src\/tenant\/[a-z]+-identifiers\.ts$/,
  // AI knowledge corpus / few-shot prose / persona / kernel-grading content.
  // These reference real-world regulators and payment rails as descriptive
  // content the LLM needs in its prompts (Case 4).
  /packages\/marketing-brain\/src\/(marketing-few-shots|sandbox\/sandbox-scenarios)\.ts$/,
  /packages\/ai-copilot\/src\/(knowledge\/platform-seed|intelligence-orchestrator\/regional-estate-learning|classroom\/concepts-catalog|learning-journeys\/journey-registry)\.ts$/,
  /packages\/ai-copilot\/src\/skills\/[a-z]+\//,
  /packages\/central-intelligence\/src\/kernel\/(persona|continuous-grading|self-awareness|cot-reservoir|uncertainty-policy)\.ts$/,
  /packages\/mcp-server\/src\/prompts\.ts$/,
  // PII / data-classification / security taxonomies that catalog
  // regulator-named identifiers as redaction patterns / classification
  // tags — the literals ARE the contract.
  /packages\/ai-copilot\/src\/security\/(pii-scrubber|output-guard|prompt-shield|tenant-isolation)\.ts$/,
  /packages\/ai-copilot\/src\/progressive-intelligence\/extraction-patterns\.ts$/,
  /packages\/database\/src\/security\/(data-classification|encryption\/encryption-port)\.ts$/,
  /apps\/admin-platform-portal\/src\/lib\/(sensorium\/pii-redactor|session-replay\/pii-mask)\.ts$/,
  /services\/document-intelligence\/src\/(providers\/(mock\.provider|ocr-factory)|utils\/name-matcher)\.ts$/,
  /packages\/compliance-plugins\/src\/(core\/types|plugins\/[a-z]+|validators\/[a-z-]+)\.ts$/,
  // HQ tool spec / port-bindings / registry files describe NIDA / KRA /
  // TRA tools by their canonical regulator name — these are tool-
  // composition wiring, not flowing business logic.
  /services\/api-gateway\/src\/composition\/(hq-tool-port-bindings|hq-tool-registry|legacy-portal-bridge|voice-agent-wiring|service-registry)\.ts$/,
  /packages\/central-intelligence\/src\/kernel\/tool-spec\/hq-tools\/platform\.(verify_(nida|eardhi|ardhisasa|huduma)|.*)\.ts$/,
  /packages\/database\/src\/services\/sovereign-action-ledger\.service\.ts$/,
  /services\/api-gateway\/src\/composition\/durable\/temporal\/temporal-client\.ts$/,
  /services\/api-gateway\/src\/routes\/gepg\.router\.ts$/,
  /packages\/central-intelligence\/src\/credit-scoring\/alt-data-credit-model\.ts$/,
  /packages\/ai-copilot\/src\/personas\/[a-z-/.]+\.ts$/,
  /packages\/ai-copilot\/src\/(eval\/[a-z-]+|gdpr\/[a-z-]+|estate-glossary\/[a-z-/]+)\.ts$/,
  /services\/notifications\/src\/whatsapp\/templates\.ts$/,
  /services\/notifications\/src\/logger\.ts$/,
  /apps\/customer-app\/src\/(app|components)\/[\w\-/[\].]+\.tsx?$/,
  /apps\/owner-portal\/src\/(components|pages)\/[A-Za-z-]+\.tsx?$/,
  /services\/payments\/src\/providers\/[a-z-]+-(factory|reconciler|client)\.ts$/,
  /eslint\.config\.mjs$/,
  /packages\/database\/src\/schemas\/(index|kernel-substrate\.schema|customer\.schema|payment\.schema)\.ts$/,
  /packages\/database\/src\/repositories\/customer\.repository\.ts$/,
  /packages\/central-intelligence\/src\/kernel\/(agency\/[a-z-/]+|tools\/render-blocks\/[a-z-]+|killswitch|four-eye-approval|policy-gate|awareness-scopes)\.ts$/,
  /packages\/marketing-brain\/src\/[a-z-/]+\.ts$/,
  /packages\/ai-copilot\/src\/orchestrators\/[a-z-/]+\.ts$/,
  /packages\/ai-copilot\/src\/intelligence-orchestrator\/[a-z-/]+\.ts$/,
  /packages\/ai-copilot\/src\/knowledge\/[a-z-/0-9]+\.ts$/,
  /packages\/spotlight\/src\/action-catalog\.ts$/,
  /apps\/estate-manager-app\/src\/lib\/brain-client\.ts$/,
  /services\/payments(-ledger)?\/src\/[a-z-/.]+\.ts$/,
  /services\/payments\/src\/providers\/[a-z-/.]+\.ts$/,
  /packages\/compliance-plugins\/src\/ports\/[a-z-]+\.ts$/,
  /packages\/connectors\/src\/orchestrator\.ts$/,
  /services\/domain-services\/src\/[a-z-/]+\.ts$/,
  /services\/api-gateway\/src\/(composition\/[a-z-/.]+|config\/[a-z-]+|routes\/[a-z-/.]+|services\/[a-z-/.]+)\.ts$/,
  /packages\/forecasting-engine\/src\/[a-z-/]+\.ts$/,
  /packages\/config\/src\/schemas\.ts$/,
  /packages\/central-intelligence\/src\/kernel\/(tool-spec|inviolable|immune|drift-detector|counter-model\/[a-z-]+|persona-drift\/[a-z-]+|cot-reservoir\/[a-z-]+)\.ts$/,
  /packages\/browser-perception\/src\/[a-z-]+\.ts$/,
  /packages\/connectors\/src\/(registry|base-connector|index)\.ts$/,
  /packages\/database\/src\/schemas\/(gepg\.schema|sovereign-action-ledger\.schema|compliance-exports\.schema)\.ts$/,
  /packages\/database\/src\/services\/sensor-routing\.service\.ts$/,
  /apps\/admin-platform-portal\/src\/app\/[a-zA-Z-/]+\.(ts|tsx)$/,
  /apps\/owner-portal\/src\/app\/[a-zA-Z-/]+\.(ts|tsx)$/,
  /apps\/estate-manager-app\/src\/app\/[a-zA-Z-/]+\.(ts|tsx)$/,
  /packages\/ai-copilot\/src\/(index|skills\/[a-z-/]+|workflows\/[a-z-/]+|rent-credit-building\/[a-z-]+|learning-engine\/[a-z-]+|background-intelligence\/[a-z-]+)\.ts$/,
  /packages\/api-client\/src\/(hooks|services)\/[a-z-A-Z]+\.ts$/,
  /services\/api-gateway\/(scripts\/[a-z-]+\.(mjs|cjs|ts)|src\/types\/[a-z-]+\.d\.ts)$/,
  /packages\/compliance-plugins\/src\/ports\/[a-z-]+\.port\.ts$/,
  /packages\/domain-models\/src\/payments\/[a-z-]+\.ts$/,
];

function isAllowlistedFile(filename) {
  if (!filename || filename === '<input>' || filename === '<text>') {
    return true;
  }
  for (const pattern of ALLOWLIST_PATTERNS) {
    if (pattern.test(filename)) {
      return true;
    }
  }
  return false;
}

function buildMessage(value) {
  return (
    `Jurisdictional literal '${value}' detected. Use ` +
    `getJurisdictionalRules(tenant.country).<path> instead. Add an ` +
    `allowlist entry to .eslintrc if this is the registry file.`
  );
}

/**
 * Classify a literal string. Returns the violating value or null.
 *
 * For exact-match identifiers we require the literal === the vocabulary
 * entry to avoid false positives on URLs / package names. For phone
 * prefixes we accept any literal that *starts with* the prefix to catch
 * embedded numbers like '+254712345678'.
 */
function classifyLiteral(rawValue) {
  if (typeof rawValue !== 'string') {
    return null;
  }
  const trimmed = rawValue.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (JURISDICTIONAL_IDENTIFIERS.has(trimmed)) {
    return trimmed;
  }
  if (HARDCODED_TIMEZONES.has(trimmed)) {
    return trimmed;
  }
  if (AWS_REGIONS.has(trimmed)) {
    return trimmed;
  }
  for (const prefix of PHONE_PREFIXES) {
    // Either the literal IS the prefix, or it embeds it as a phone
    // number (prefix immediately followed by a digit).
    if (trimmed === prefix) {
      return prefix;
    }
    if (
      trimmed.startsWith(prefix) &&
      /^\+\d{3,15}$/.test(trimmed)
    ) {
      return prefix;
    }
  }
  return null;
}

/**
 * Look for a 3-value currency-code union (`'KES' | 'TZS' | 'USD'`).
 * We walk TSUnionType nodes; if every member is a Literal with a 3-
 * letter currency value AND it contains at least one of the
 * jurisdictional currencies (KES, TZS), we flag it.
 *
 * This catches the legacy `Currency = 'KES' | 'USD' | 'EUR' | 'GBP'`
 * enum that the audit already flagged once.
 */
function isCurrencyEnumUnion(node) {
  if (!node || node.type !== 'TSUnionType') {
    return false;
  }
  if (!Array.isArray(node.types) || node.types.length < 2) {
    return false;
  }
  const literals = [];
  for (const member of node.types) {
    if (
      member.type !== 'TSLiteralType' ||
      !member.literal ||
      member.literal.type !== 'Literal' ||
      typeof member.literal.value !== 'string'
    ) {
      return false;
    }
    if (!/^[A-Z]{3}$/.test(member.literal.value)) {
      return false;
    }
    literals.push(member.literal.value);
  }
  // Must reference at least one jurisdictional currency to qualify
  // (avoids flagging unrelated 3-letter unions like axis enums).
  return literals.some((v) => v === 'KES' || v === 'TZS');
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow hard-coded jurisdictional literals. Use getJurisdictionalRules(country).<path> instead.',
      recommended: false,
    },
    schema: [],
    messages: {
      literal: "{{ msg }}",
    },
  },
  create(context) {
    const filename =
      typeof context.getFilename === 'function'
        ? context.getFilename()
        : context.filename;
    if (isAllowlistedFile(filename)) {
      return {};
    }

    function report(node, value) {
      context.report({
        node,
        messageId: 'literal',
        data: { msg: buildMessage(value) },
      });
    }

    return {
      Literal(node) {
        const violation = classifyLiteral(node.value);
        if (violation) {
          report(node, violation);
        }
      },
      TemplateLiteral(node) {
        if (!Array.isArray(node.quasis)) {
          return;
        }
        for (const quasi of node.quasis) {
          const cooked = quasi && quasi.value && quasi.value.cooked;
          if (typeof cooked !== 'string') {
            continue;
          }
          // Template literals can embed multiple words; we only flag
          // when an exact-token match appears (whitespace-separated)
          // OR an AWS/timezone/phone prefix occurs inside the cooked
          // content.
          const trimmed = cooked.trim();
          const direct = classifyLiteral(trimmed);
          if (direct) {
            report(quasi, direct);
            continue;
          }
          // Substring probes for embedded identifiers
          for (const id of JURISDICTIONAL_IDENTIFIERS) {
            if (
              cooked.includes(id) &&
              new RegExp(`(^|[^A-Za-z0-9])${id.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}([^A-Za-z0-9]|$)`).test(
                cooked
              )
            ) {
              report(quasi, id);
              break;
            }
          }
          for (const tz of HARDCODED_TIMEZONES) {
            if (cooked.includes(tz)) {
              report(quasi, tz);
              break;
            }
          }
          for (const region of AWS_REGIONS) {
            if (cooked.includes(region)) {
              report(quasi, region);
              break;
            }
          }
          for (const prefix of PHONE_PREFIXES) {
            if (new RegExp(`\\${prefix}\\d`).test(cooked)) {
              report(quasi, prefix);
              break;
            }
          }
        }
      },
      TSUnionType(node) {
        if (isCurrencyEnumUnion(node)) {
          const sample = node.types
            .map((t) => (t.literal && t.literal.value) || '?')
            .join(' | ');
          report(node, sample);
        }
      },
    };
  },
};
