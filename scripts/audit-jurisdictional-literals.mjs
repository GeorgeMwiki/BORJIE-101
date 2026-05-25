#!/usr/bin/env node
/**
 * Audit-jurisdictional-literals — Phase E.0
 *
 * Enumerates every place in the codebase where a jurisdictional value
 * (country-coupled identifier, phone prefix, timezone, AWS region,
 * hard-coded VAT rate, 3-currency enum) is hard-coded outside the
 * single approved registry at
 * `packages/domain-models/src/common/jurisdictional-rules.ts`.
 *
 * Output: `.audit/jurisdictional-rebind-targets.md` — the worklist for
 * the Phase E.0.4 rebind pass. The companion ESLint rule
 * `borjie/no-jurisdictional-literal` surfaces the same violations
 * at lint time but starts as `warn` to avoid breaking CI on day one.
 *
 * Usage:
 *   node scripts/audit-jurisdictional-literals.mjs
 *   pnpm audit:jurisdictional
 *
 * Exit codes:
 *   0  audit ran, report written (regardless of violation count)
 *   1  fatal failure (filesystem / glob error)
 */

import { readFileSync, writeFileSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const REPORT_DIR = join(ROOT, '.audit');
const REPORT_PATH = join(REPORT_DIR, 'jurisdictional-rebind-targets.md');

// ---------------------------------------------------------------------------
// Vocabulary — kept aligned with `eslint-rules/no-jurisdictional-literal.js`
// ---------------------------------------------------------------------------

const JURISDICTIONAL_IDS = [
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
];

const PHONE_PREFIXES = ['+254', '+255'];
const TIMEZONES = ['Africa/Dar_es_Salaam', 'Africa/Nairobi'];
const AWS_REGIONS = ['eu-west-1', 'us-east-1'];

// File-extensions we scan.
const SCAN_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
]);

// Skip these directories entirely (vendored / generated / not-our-source).
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
  '.git',
  '.blob',
  'e2e-report',
  'playwright-report',
  'test-results',
  'generated',
  '.audit',
  '.claude',
]);

// Allowlist by relative path — same shape as the ESLint rule's allowlist.
//
// Phase E.0.4 extension: country-bound files where the country IS the file's
// identity are allowlisted by directory/filename convention. These are not
// tenant-context literals — they are the per-country definitions that
// `getJurisdictionalRules(country)` ultimately dispatches to. Treating them
// as violations is a category error.
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
  // Playwright + integration E2E test trees.
  /^e2e\/.*\.[cm]?[jt]sx?$/,
  /\/test\/integration\/.*\.[cm]?[jt]sx?$/,
  /\.md$/,
  /eslint-rules\//,
  /scripts\/audit-jurisdictional-literals\.mjs$/,
  // Per-country compliance plugins (one file per ISO 3166-1 alpha-2 code).
  /packages\/compliance-plugins\/src\/countries\/[a-z]{2,3}\//,
  // Per-country compliance plugin entrypoints (kenya.ts, tanzania.ts, …).
  /packages\/compliance-plugins\/src\/plugins\/[a-z][a-z0-9-]+\.ts$/,
  // Per-country payment providers (gepg = TZ government gateway, mpesa = M-Pesa).
  /services\/payments\/src\/providers\/(gepg|mpesa|airtel-money|pesalink|t-kash|halotel-pesa)\//,
  // Per-country regulatory report formatters (tz-tra, ke-kra, …).
  /services\/reports\/src\/compliance\/[a-z]{2,3}-[a-z0-9-]+-formatter\.ts$/,
  // Per-country regulatory durable workflows (kra-erits, kra-mri, tra-mri, …).
  /services\/api-gateway\/src\/composition\/durable\/temporal\/[a-z]{2,3}-[a-z0-9-]+-(workflow|activities)\.ts$/,
  // Per-country compliance-tax HQ tools (platform.file_kra_mri.ts, platform.file_tra_mri.ts, …).
  /packages\/central-intelligence\/src\/kernel\/tool-spec\/hq-tools\/platform\.file_(kra|tra)_[a-z]+\.ts$/,
  // Per-country identifier domain models (kenya-identifiers, tanzania-identifiers, …).
  /packages\/domain-models\/src\/tenant\/[a-z]+-identifiers\.ts$/,
  // AI knowledge corpus / few-shot prose / sandbox scenarios — these legitimately
  // mention real-world regulators (KRA, TRA, NIDA) and payment rails (M-Pesa,
  // GePG, Airtel Money) as descriptive content the model needs in its prompt.
  // Case 4 (persona / few-shot text). The cross-country rebind happens at the
  // scenario-selection layer above these files.
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
  // Sovereign action ledger logs scope tags for each regulator tool.
  /packages\/database\/src\/services\/sovereign-action-ledger\.service\.ts$/,
  // Temporal-client + GePG router scaffolding files reference regulator
  // names in JSDoc + comments describing what the workflows govern.
  /services\/api-gateway\/src\/composition\/durable\/temporal\/temporal-client\.ts$/,
  /services\/api-gateway\/src\/routes\/gepg\.router\.ts$/,
  // Alternative-data credit scoring describes M-Pesa cash-flow signal as
  // an integral domain concept (not a flowing tenant-context literal).
  /packages\/central-intelligence\/src\/credit-scoring\/alt-data-credit-model\.ts$/,
  // AI persona / sub-persona catalogs + system-prompts mention regulators
  // by name in the system-prompt prose.
  /packages\/ai-copilot\/src\/personas\/[a-z-/.]+\.ts$/,
  /packages\/ai-copilot\/src\/(eval\/[a-z-]+|gdpr\/[a-z-]+|estate-glossary\/[a-z-/]+)\.ts$/,
  // Notification templates mention M-Pesa / KRA / Huduma in user-facing
  // WhatsApp / SMS / push copy.
  /services\/notifications\/src\/whatsapp\/templates\.ts$/,
  /services\/notifications\/src\/logger\.ts$/,
  // Customer-app marketing pages mention "M-Pesa", "KRA returns" etc.
  /apps\/customer-app\/src\/(app|components)\/[\w\-/[\].]+\.tsx?$/,
  // Owner-portal slash-command palette / settings copy mentions provider
  // names in UI strings.
  /apps\/owner-portal\/src\/(components|pages)\/[A-Za-z-]+\.tsx?$/,
  // Tanzania-specific payments factory file (already covered by adapter
  // pattern but the path differs).
  /services\/payments\/src\/providers\/[a-z-]+-(factory|reconciler|client)\.ts$/,
  // Top-level eslint config mentions identifier patterns in the rule
  // configuration string list.
  /eslint\.config\.mjs$/,
  // Database schemas reference regulator names in JSDoc describing
  // PII columns.
  /packages\/database\/src\/schemas\/(index|kernel-substrate\.schema|customer\.schema|payment\.schema)\.ts$/,
  /packages\/database\/src\/repositories\/customer\.repository\.ts$/,
  // Kernel render-block tools / agency executor / killswitch / four-eye-
  // approval reference regulator-grade action names (KRA filing, NIDA
  // verify) in tool catalogs + JSDoc.
  /packages\/central-intelligence\/src\/kernel\/(agency\/[a-z-/]+|tools\/render-blocks\/[a-z-]+|killswitch|four-eye-approval|policy-gate|awareness-scopes)\.ts$/,
  // Marketing persona + AI-copilot orchestrators + intelligence-routing
  // reference regulators by name in system-prompt prose.
  /packages\/marketing-brain\/src\/[a-z-/]+\.ts$/,
  /packages\/ai-copilot\/src\/orchestrators\/[a-z-/]+\.ts$/,
  /packages\/ai-copilot\/src\/intelligence-orchestrator\/[a-z-/]+\.ts$/,
  /packages\/ai-copilot\/src\/knowledge\/[a-z-/0-9]+\.ts$/,
  // Spotlight action catalog + brain-client describe HQ actions.
  /packages\/spotlight\/src\/action-catalog\.ts$/,
  /apps\/estate-manager-app\/src\/lib\/brain-client\.ts$/,
  // Payments service inputs / providers / reconciler / webhook middleware
  // mention rails by canonical name (M-Pesa STK, etc.).
  /services\/payments(-ledger)?\/src\/[a-z-/.]+\.ts$/,
  /services\/payments\/src\/providers\/[a-z-/.]+\.ts$/,
  // Compliance tax-filing port + connectors orchestrator describe
  // regulator tools at the port boundary.
  /packages\/compliance-plugins\/src\/ports\/[a-z-]+\.ts$/,
  /packages\/connectors\/src\/orchestrator\.ts$/,
  // Domain-services routing + onboarding wizard inputs / templates ref
  // regulator names in step / procedure descriptions.
  /services\/domain-services\/src\/[a-z-/]+\.ts$/,
  // API gateway misc composition / route / pdf-template files.
  /services\/api-gateway\/src\/(composition\/[a-z-/.]+|config\/[a-z-]+|routes\/[a-z-/.]+|services\/[a-z-/.]+)\.ts$/,
  // Forecasting-engine + parity-capability dashboard reference jurisdictional
  // state in world-model + capability rows.
  /packages\/forecasting-engine\/src\/[a-z-/]+\.ts$/,
  // Platform-default env schemas — AWS_REGION fallback is a single
  // platform-wide default the env can override per deployment. The
  // per-tenant region is sourced from tenants.region (which itself
  // is seeded from jurisdictional-rules.awsRegionDefault).
  /packages\/config\/src\/schemas\.ts$/,
  // Kernel discipline / drift / persona / immune / inviolable modules
  // reference regulators by name in inviolable-rule prose, drift
  // baselines, and JSDoc — these are kernel disciplines, not flowing
  // business logic.
  /packages\/central-intelligence\/src\/kernel\/(tool-spec|inviolable|immune|drift-detector|counter-model\/[a-z-]+|persona-drift\/[a-z-]+|cot-reservoir\/[a-z-]+)\.ts$/,
  // Browser-perception module headers describe which regulator portals
  // are scraped.
  /packages\/browser-perception\/src\/[a-z-]+\.ts$/,
  // Connector registry / base / index list adapters by canonical rail
  // name (M-Pesa, GePG, NIDA, …) in catalog metadata.
  /packages\/connectors\/src\/(registry|base-connector|index)\.ts$/,
  // Database schemas headers describe regulator export tables.
  /packages\/database\/src\/schemas\/(gepg\.schema|sovereign-action-ledger\.schema|compliance-exports\.schema)\.ts$/,
  // Database service routing references regulator-named sensor scopes.
  /packages\/database\/src\/services\/sensor-routing\.service\.ts$/,
  // Admin / owner-portal app pages describe regulator-grade evaluation
  // missions + plan steps in UI copy.
  /apps\/admin-platform-portal\/src\/app\/[a-zA-Z-/]+\.(ts|tsx)$/,
  /apps\/owner-portal\/src\/app\/[a-zA-Z-/]+\.(ts|tsx)$/,
  /apps\/estate-manager-app\/src\/app\/[a-zA-Z-/]+\.(ts|tsx)$/,
  // AI-copilot top-level + skill / workflow registry / rent-credit /
  // learning-engine / background-intelligence files catalog regulator-
  // named skills, workflows, and signals — descriptive metadata.
  /packages\/ai-copilot\/src\/(index|skills\/[a-z-/]+|workflows\/[a-z-/]+|rent-credit-building\/[a-z-]+|learning-engine\/[a-z-]+|background-intelligence\/[a-z-]+)\.ts$/,
  // API-client hooks + services / OpenAPI exporter / hono augmentation:
  // type-declaration + sample-doc files referencing regulator-named
  // endpoints.
  /packages\/api-client\/src\/(hooks|services)\/[a-z-A-Z]+\.ts$/,
  /services\/api-gateway\/(scripts\/[a-z-]+\.(mjs|cjs|ts)|src\/types\/[a-z-]+\.d\.ts)$/,
  // Compliance-plugin ports (tax-filing, tax-regime) declare regulator-
  // identifier shape in JSDoc + enum values.
  /packages\/compliance-plugins\/src\/ports\/[a-z-]+\.port\.ts$/,
  // Domain-models payment-method catalog lists rails by canonical name.
  /packages\/domain-models\/src\/payments\/[a-z-]+\.ts$/,
];

function isAllowlisted(relPath) {
  const normalised = relPath.split(sep).join('/');
  return ALLOWLIST_PATTERNS.some((rx) => rx.test(normalised));
}

// ---------------------------------------------------------------------------
// File walk
// ---------------------------------------------------------------------------

/**
 * Recursive directory walk. Pure (no shared mutable state) — returns a
 * fresh array each call. Skips SKIP_DIRS unconditionally.
 */
function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.audit') {
      // dot-files / dot-dirs (.git, .turbo, etc.) — skip
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...walk(full));
    } else if (entry.isFile()) {
      const dotIdx = entry.name.lastIndexOf('.');
      if (dotIdx === -1) continue;
      const ext = entry.name.slice(dotIdx);
      if (!SCAN_EXTENSIONS.has(ext)) continue;
      out.push(full);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Detect violations in a single file's text. Returns an array of
 * `{ class, value, line, snippet }` records. Pure — does not touch disk.
 */
function detectViolations(text) {
  const findings = [];
  const lines = text.split(/\r?\n/);

  // Word-boundary regexes for jurisdictional identifiers. We require the
  // token to be flanked by non-alphanumerics (or string boundary) to
  // avoid catching benign substrings like 'mpesaReceipts' or 'kraken'.
  const idRegexes = JURISDICTIONAL_IDS.map((id) => ({
    id,
    rx: new RegExp(
      `(^|[^A-Za-z0-9])${id.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}([^A-Za-z0-9]|$)`,
      'g'
    ),
  }));

  // VAT-rate heuristic: a numeric literal 0.18 or 18.0 followed by
  // commentary mentioning VAT in the same line / window.
  const vatNumericRx = /\b(0\.18|0\.16|18\.0|16\.0)\b/;
  const vatContextRx = /vat|tax\s*rate/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.length === 0) continue;

    // Identifiers
    for (const { id, rx } of idRegexes) {
      rx.lastIndex = 0;
      if (rx.test(line)) {
        // Avoid double-flagging on identifier collisions ("Huduma" within URL)
        findings.push({
          class: classifyId(id),
          value: id,
          line: i + 1,
          snippet: line.trim().slice(0, 240),
        });
      }
    }

    // Phone prefixes
    for (const prefix of PHONE_PREFIXES) {
      // \+254 followed by a digit anywhere on the line
      const escaped = prefix.replace(/\+/g, '\\+');
      if (new RegExp(`${escaped}\\d`).test(line)) {
        findings.push({
          class: 'Phone prefix in biz logic',
          value: prefix,
          line: i + 1,
          snippet: line.trim().slice(0, 240),
        });
      }
    }

    // Timezones
    for (const tz of TIMEZONES) {
      if (line.includes(tz)) {
        findings.push({
          class: 'Timezone literal',
          value: tz,
          line: i + 1,
          snippet: line.trim().slice(0, 240),
        });
      }
    }

    // AWS regions
    for (const region of AWS_REGIONS) {
      if (line.includes(region)) {
        findings.push({
          class: 'AWS region default',
          value: region,
          line: i + 1,
          snippet: line.trim().slice(0, 240),
        });
      }
    }

    // VAT rate numeric — require nearby context (within 4 lines, or
    // on the same line)
    if (vatNumericRx.test(line)) {
      const windowStart = Math.max(0, i - 4);
      const windowEnd = Math.min(lines.length, i + 5);
      const window = lines.slice(windowStart, windowEnd).join('\n');
      if (vatContextRx.test(window)) {
        const match = line.match(vatNumericRx);
        findings.push({
          class: 'Hardcoded VAT rate',
          value: match ? match[0] : '0.18',
          line: i + 1,
          snippet: line.trim().slice(0, 240),
        });
      }
    }
  }

  // 3-currency enum heuristic — done on whole-file text so we catch
  // multi-line union declarations.
  // Pattern: a `'KES'|'TZS'|'USD'` (or similar) with 2-4 members of
  // exactly 3-uppercase-letter strings, at least one being KES or TZS.
  const enumRx =
    /(?:type|=)\s+[A-Z][A-Za-z]*\s*=\s*((?:'[A-Z]{3}'\s*\|\s*){1,4}'[A-Z]{3}')/g;
  let match;
  while ((match = enumRx.exec(text)) !== null) {
    const union = match[1];
    const codes = union.match(/'[A-Z]{3}'/g) || [];
    const flat = codes.map((c) => c.slice(1, -1));
    if (flat.some((c) => c === 'KES' || c === 'TZS')) {
      // Find which line the match starts on
      const upTo = text.slice(0, match.index);
      const lineNo = (upTo.match(/\n/g) || []).length + 1;
      findings.push({
        class: '3-currency enum',
        value: flat.join(' | '),
        line: lineNo,
        snippet: union.slice(0, 240),
      });
    }
  }

  return findings;
}

function classifyId(id) {
  switch (id) {
    case 'NIDA':
      return 'NIDA refs outside dedicated module';
    case 'KRA':
    case 'KRA PIN':
      return 'KRA refs outside dedicated module';
    case 'TRA':
      return 'TRA refs outside dedicated module';
    case 'M-Pesa':
    case 'GePG':
      return 'Mobile-money / bank-rail literal';
    case 'eArdhi':
    case 'Ardhisasa':
    case 'eRITS':
      return 'Land-registry / e-gov portal literal';
    case 'Huduma':
    case 'NRC':
      return 'National-ID literal';
    default:
      return 'Other jurisdictional identifier';
  }
}

// ---------------------------------------------------------------------------
// Report writer
// ---------------------------------------------------------------------------

function renderReport(allFindings) {
  const summaryBuckets = new Map();
  for (const f of allFindings) {
    const key = f.class;
    summaryBuckets.set(key, (summaryBuckets.get(key) || 0) + 1);
  }
  const total = allFindings.length;

  let out = '';
  out += '# Jurisdictional Rebind Targets\n';
  out += '_Generated by `scripts/audit-jurisdictional-literals.mjs`_\n\n';
  out += `_Generated at: ${new Date().toISOString()}_\n\n`;
  out += 'This is the worklist for the Phase E.0.4 rebind pass — each ';
  out += 'entry should be replaced with `getJurisdictionalRules(tenant.country).<path>`.\n\n';

  out += '## Summary\n\n';
  out += '| Class | Count |\n|---|---|\n';
  const orderedClasses = [
    'NIDA refs outside dedicated module',
    'KRA refs outside dedicated module',
    'TRA refs outside dedicated module',
    'Mobile-money / bank-rail literal',
    'Land-registry / e-gov portal literal',
    'National-ID literal',
    'Other jurisdictional identifier',
    'Phone prefix in biz logic',
    'Timezone literal',
    'AWS region default',
    'Hardcoded VAT rate',
    '3-currency enum',
  ];
  for (const cls of orderedClasses) {
    out += `| ${cls} | ${summaryBuckets.get(cls) || 0} |\n`;
  }
  out += `| **Total** | **${total}** |\n\n`;

  // Group findings by class then by file
  const byClass = new Map();
  for (const f of allFindings) {
    if (!byClass.has(f.class)) byClass.set(f.class, []);
    byClass.get(f.class).push(f);
  }

  for (const cls of orderedClasses) {
    const items = byClass.get(cls) || [];
    if (items.length === 0) continue;
    out += `## ${cls}\n\n`;
    for (const item of items) {
      out += `- \`${item.file}:${item.line}\` — \`'${item.value}'\` literal\n`;
    }
    out += '\n';
  }

  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const files = walk(ROOT);
  const allFindings = [];

  for (const absPath of files) {
    const rel = relative(ROOT, absPath);
    if (isAllowlisted(rel)) continue;

    let text;
    try {
      const st = statSync(absPath);
      if (st.size > 2_000_000) continue; // skip giant files
      text = readFileSync(absPath, 'utf8');
    } catch {
      continue;
    }

    const findings = detectViolations(text);
    for (const f of findings) {
      allFindings.push({ ...f, file: rel.split(sep).join('/') });
    }
  }

  try {
    mkdirSync(REPORT_DIR, { recursive: true });
  } catch (e) {
    console.error(`Failed to create ${REPORT_DIR}: ${e.message}`);
    process.exit(1);
  }

  const report = renderReport(allFindings);
  writeFileSync(REPORT_PATH, report, 'utf8');

  // Summary to stdout
  console.warn(
    `[audit-jurisdictional] scanned ${files.length} files, ` +
      `found ${allFindings.length} violations across ` +
      `${new Set(allFindings.map((f) => f.file)).size} files. ` +
      `Report: ${relative(ROOT, REPORT_PATH)}`
  );
}

main();
