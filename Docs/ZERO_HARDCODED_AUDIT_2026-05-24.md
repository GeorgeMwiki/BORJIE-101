# Zero-Hardcoded Audit 2026-05-24

**Read-only deep scrub — final commit (3 of 3).** Scope: every package,
service, and app outside the eight in-flight-agent paths (see "Out of
scope" at the bottom). This third commit appends AI / intelligence
anti-patterns and the recommended fix-wave plan.

## Executive summary

| Severity | Count | Confidence |
|----------|-------|------------|
| CRITICAL | 0 hard secrets, 0 prod tenant-id leaks | high |
| HIGH (config-leak / silent-degradation risk) | 12 | high |
| MEDIUM (cleanup-when-touching-nearby) | 17 (top-N + bucketed) | medium |
| AI/intelligence anti-patterns | 6 (1 high, 5 medium) | medium |
| Files scanned | ~2,400 production `*.ts`/`*.tsx` across `packages/`, `services/`, `apps/` | — |

### Top 5 most-dangerous findings (verbatim)

1. `services/payments-ledger/src/server.ts:155` —
   `const platformFee = parseFloat(process.env.PLATFORM_FEE_PERCENT || '5.0');`
   Platform fee defaulted to 5.0 % silently when env unset. **Wrong tenant gets billed.**
2. `packages/central-intelligence/src/kernel/tools/graph-tools.ts:285` & `:686` —
   `... ELSE 'KES' END AS currency` and `currency: toStr(r.currency, 'KES')`.
   Cypher query and projection default currency to KES even when tenant is in TZ/UG/RW. Per the questionnaire memo §1 this must come from `tenantContext.currency`.
3. `packages/central-intelligence/src/kernel/sub-mds/kra-filing-assistant/tools/draft-filing.ts:56` —
   `const currency = batch.lines[0]?.currency ?? 'KES';`
   KRA eRITS draft falls back to KES when an empty batch arrives. KRA filings are KE-only so the literal is technically correct, but the silent fallback hides a malformed batch.
4. `packages/database/src/schemas/property.schema.ts:96` —
   `country: text('country').notNull().default('KE'),`
   DB-level default for property country is `'KE'`. Comment acknowledges it's a "safety net" but a property created without explicit country will be silently Kenyan.
5. `services/api-gateway/src/middleware/auth.middleware.ts:34-35` —
   `const JWT_ISSUER = process.env.JWT_ISSUER || 'borjie';` and `JWT_AUDIENCE = ... || 'borjie-api';`
   JWT issuer/audience silently default. Multi-region deploys will mint tokens with the wrong audience → cross-region replay risk. Should `requireEnv` like the signing secrets above them.

---

## Critical findings (must-fix before live test)

**None.** No hardcoded API keys, AWS access keys, JWT signing secrets, Stripe live keys, Supabase service-role tokens, or live-tenant UUIDs were found in any production code path.

Scan coverage:
- Secret patterns scanned: `sk-ant-*`, `sk-*`, `AKIA[A-Z0-9]{16}`, `sk_live_*`, JWT-tokens (`eyJ...`)
- Tenant-id patterns scanned: `'trc-*'`, `tenantId: 'demo-*'`, `tenantId: 'org-*'`
- Result: 0 production hits. The single `'tenant-uuid'` literal found in `packages/supabase-client/src/rls-aware-client.ts:19` is a JSDoc example, not executable code (safe).

---

## High findings (config-leak / silent degradation)

### HI-1: Platform fee silent fallback to 5 %
- File: `services/payments-ledger/src/server.ts:155`
- Snippet: `const platformFee = parseFloat(process.env.PLATFORM_FEE_PERCENT || '5.0');`
- Why high: per the questionnaire memo §1, platform fees live in `tenants.settings.elasticConfig`. A missing env value should fail-loud (throw) so the operator knows the tenant config isn't wired, NOT silently bill 5 %.
- Suggested fix: `const platformFee = parseFloat(requireEnv('PLATFORM_FEE_PERCENT'));` and source from tenant aggregate when ledger gets per-tenant rates.

### HI-2: Property default-country silently `'KE'` at DB level
- File: `packages/database/src/schemas/property.schema.ts:96`
- Snippet: `country: text('country').notNull().default('KE'),`
- Why high: a new property without explicit country becomes Kenyan. Inline comment says the application MUST pass tenant country — but the safety-net default contradicts the comment and will silently misclassify properties in TZ/UG/RW.
- Suggested fix: drop the DB default (the tenants table already did this in migration 0034), or override to `getJurisdictionalRules(tenantContext.jurisdiction).countryCode` at application layer.

### HI-3: JWT_ISSUER / JWT_AUDIENCE default literals
- File: `services/api-gateway/src/middleware/auth.middleware.ts:34-35`
- Snippet: `const JWT_ISSUER = process.env.JWT_ISSUER || 'borjie';`
- Why high: cross-region/multi-env deploys (staging, EU, etc.) need distinct issuer/audience to prevent token replay. Defaults make staging tokens validate in prod.
- Suggested fix: use `requireEnv('JWT_ISSUER')` like the signing secrets above.

### HI-4: graph-tools.ts Cypher default currency `'KES'`
- File: `packages/central-intelligence/src/kernel/tools/graph-tools.ts:285` and projection at `:654`, `:686`
- Snippet (285): `CASE WHEN size(currencies) > 0 THEN head(currencies) ELSE 'KES' END AS currency,`
- Snippet (654): `currency: 'KES',` (empty-lease-network fallback object)
- Snippet (686): `currency: toStr(r.currency, 'KES'),`
- Why high: graph queries serve all tenants regardless of jurisdiction. Hardcoded KES will report wrong currency for any non-KE tenant. Per questionnaire memo §1 currency should come from `tenantContext.currency`.
- Suggested fix: accept `currency` as a parameter from the call site (already passes `tenantId`), drive from `tenantContext.currency`.

### HI-5: KRA filing fallback currency `'KES'`
- File: `packages/central-intelligence/src/kernel/sub-mds/kra-filing-assistant/tools/draft-filing.ts:56`
- Snippet: `const currency = batch.lines[0]?.currency ?? 'KES';`
- Why high: KRA filings are KE-only so literally KES is correct, BUT the fallback hides a malformed batch (zero lines) — should throw or warn.
- Suggested fix: `if (!batch.lines[0]?.currency) throw new Error('KRA batch has no lines with currency');`

### HI-6: VP Finance report literal currency
- File: `packages/central-intelligence/src/kernel/vp-personas/vp-finance/report.ts:46, :59`
- Snippet: `numericUnit: 'KES',`
- Why high: report unit always KES; non-KE tenants see KES totals incorrectly.
- Suggested fix: source from `tenantContext.currency`.

### HI-7: owner.financial_summary `'KES'` literal fallback
- File: `packages/central-intelligence/src/kernel/tool-spec/owner-tools/owner.financial_summary.ts:115`
- Snippet: `: 'KES');`
- Why high: same currency-leak risk as HI-4/HI-6.
- Suggested fix: replace with `tenantContext.currency` or `currency_preferences` lookup (the questionnaire memo names the table).

### HI-8: PLATFORM_DEFAULT_REGION hardcoded `'TZ'`
- File: `packages/database/src/schemas/tenant.schema.ts:23`
- Snippet: `const PLATFORM_DEFAULT_REGION = getJurisdictionalRules('TZ').awsRegionDefault;`
- Why high: a tenant created without explicit region inherits the TZ region. Acceptable for pilot but should be sourced from `process.env.PLATFORM_DEFAULT_JURISDICTION` so EU/US rollout doesn't require code change.
- Suggested fix: `const PLATFORM_DEFAULT_REGION = getJurisdictionalRules(process.env.PLATFORM_DEFAULT_JURISDICTION ?? 'TZ').awsRegionDefault;`

### HI-9: STORAGE_BASE_URL silent fallback to `/storage`
- File: `services/document-intelligence/src/routes/documents.routes.ts:461, :507`
- Snippet: ``pdfUrl: `${process.env.STORAGE_BASE_URL || '/storage'}/packs/...`,``
- Why high: missing env yields relative `/storage/packs/foo.pdf` URLs that won't resolve outside the container's reverse-proxy. Downloads will 404 in prod if env missing.
- Suggested fix: `requireEnv('STORAGE_BASE_URL')`.

### HI-10: MPESA environment fallback `'sandbox'` in prod
- File: `services/payments/src/mpesa/stk-push.ts:56`
- Snippet: `environment: (config?.environment || process.env.MPESA_ENVIRONMENT || 'sandbox') as 'sandbox' | 'production',`
- Why high: misconfigured prod deploy silently bills sandbox. Real money does not move and operator won't notice until reconciliation.
- Suggested fix: throw when `NODE_ENV === 'production'` and `MPESA_ENVIRONMENT` is not set.

### HI-11: Inline default OPENAI model `'gpt-4-turbo-preview'`
- File: `packages/ai-copilot/src/providers/ai-provider.ts:243`
- Snippet: `const modelId = request.modelOverride ?? request.prompt.modelConfig.modelId ?? this.config.defaultModel ?? 'gpt-4-turbo-preview';`
- Why high: triple-fallback to a deprecated model name (`gpt-4-turbo-preview` was sunset; current is `gpt-4o`). Calls will 404.
- Suggested fix: drop the final literal — let the call throw if no model resolves so the developer must fix config.

### HI-12: PromptRegistry default `'gpt-4-turbo-preview'` constructor arg
- File: `packages/ai-copilot/src/prompts/prompt-registry.ts:136`
- Snippet: `private defaultModelId: string = 'gpt-4-turbo-preview'`
- Why high: same deprecated-model risk as HI-11.
- Suggested fix: require explicit `defaultModelId` at construction.

---

## Medium findings (cleanup-when-touching-nearby)

### MD-1..5: Hardcoded `maxTokens` / `temperature` in 28 LLM call sites
- Files (top 10):
  - `packages/database/src/services/sensor-routing.service.ts:125, :130, :135, :140` (sensor catalog defaults — actually CORRECT, this is the registry)
  - `packages/central-intelligence/src/kernel/sensors/anthropic-sensor.ts:431, :440, :448` (`maxTokens: 1024`)
  - `packages/central-intelligence/src/kernel/sub-mds/shared/redesign-stage.ts:45` (`maxTokens: 800`)
  - `packages/central-intelligence/src/kernel/critics/constitutional-critic.ts:276` (`max_tokens: 1024`)
  - `packages/central-intelligence/src/kernel/consolidation/consolidation-cycle.ts:230, :429` (`maxTokens: 1024`)
  - `packages/ai-copilot/src/prompts/default-prompts.ts:123, :269, :417, :564` (`temperature: 0.3 / 0.5 / 0.6 / 0.3`)
  - `packages/ai-copilot/src/services/nba-manager-queue.ts:453-454` (`temperature: 0.3, max_tokens: 2000`)
  - `packages/ai-copilot/src/services/preference-profile-engine.ts:447-448` (`temperature: 0.4, max_tokens: 1000`)
  - `packages/ai-copilot/src/services/renewal-strategy-generator.ts:631`
  - 18 similar hits across `packages/ai-copilot/src/services/`
- Why medium: numbers without `// reason:` comments — when behaviour drifts in prod no one knows whether the value was deliberate.
- Suggested fix: move per-task `temperature`/`maxTokens` into `packages/ai-copilot/src/config/llm-params.ts` keyed by task-id, with reason comments.

### MD-6: Hardcoded retry counts in queue producers/jobs
- Files:
  - `services/notifications/src/queue/producer.ts:60` (`attempts: 3`)
  - `services/notifications/src/dispatcher.ts:183` (`attempts: 1`)
  - `services/reports/src/jobs/scheduled-reports.job.ts:92` (`attempts: 3`)
  - `services/api-gateway/src/composition/durable/inngest-functions/agency-run.fn.ts:139` (`retries: 4`)
  - `packages/observability/src/event-bus.ts:175, :446` (`maxRetries: 3, 5`)
  - `packages/api-client/src/client.ts:111` (`retries: 3`)
- Why medium: 7 different files pick different numbers with no justification. Operator can't dial up resilience without code change.
- Suggested fix: central `RETRY_POLICY` config map.

### MD-7: Hardcoded localhost URLs in shared packages (NOT just configs)
- `packages/scientific-discovery/src/causal-fusion/pcmciplus-client.ts:31` — `const DEFAULT_BASE_URL = 'http://localhost:8000';`
- `packages/scientific-discovery/src/causal-fusion/refutation-client.ts:54` — same
- `packages/document-studio/src/renderers/carbone-renderer.ts:41` — `export const DEFAULT_CARBONE_URL = 'http://localhost:4000';`
- `packages/central-intelligence/src/durable/inngest-client.ts:223` — `INNGEST_LOCAL_DEV_URL = 'http://localhost:8288';` (explicitly DEV — safe)
- Why medium: shared packages re-export localhost defaults. `pcmciplus-client` / `refutation-client` / `carbone-renderer` will hit localhost in prod if env missing. Comments say "override via env" but no `requireEnv` guard.
- Suggested fix: each constructor should `requireEnv(...)` when `NODE_ENV === 'production'`.

### MD-8: `notifications` Africas-Talking username defaults to `'sandbox'`
- File: `services/notifications/src/sms/africas-talking.ts:62`
- Snippet: `username: config?.username || ... || 'sandbox'`
- Why medium: same as HI-10 but lower blast radius. Add prod-mode guard.

### MD-9: Inline default models in sub-MD critics/judges
- Files:
  - `packages/central-intelligence/src/kernel/sensors/self-grading-judge.ts:43` — `const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';`
  - `packages/central-intelligence/src/kernel/sensors/anthropic-judge.ts:57` — same
  - `packages/central-intelligence/src/kernel/critics/constitutional-critic.ts:148` — `'claude-haiku-4-5';` (note: short form — inconsistent with above)
  - `packages/central-intelligence/src/kernel/counter-model/counter-model.ts:91` — `'claude-haiku-4-5-20251001'`
  - `packages/document-ai/src/ocr/anthropic-vision-adapter.ts:34` — `'claude-opus-4-7'` (OUT OF SCOPE — `document-ai/`)
- Why medium: 4 distinct `DEFAULT_MODEL` constants for "Haiku judge" — three use the long form (`-20251001`), one uses the short form. When Anthropic deprecates a snapshot we have 4 files to update.
- Suggested fix: import from a single `packages/ai-copilot/src/providers/model-catalog.ts` (already exists as `ANTHROPIC_MODELS` — references in `multi-llm-router.ts:83-85`).

### MD-10: Locale literal `'sw-TZ'` outside i18n config
- File: `packages/content-studio/src/c2pa/visible-watermark.ts:31` and `:48`
- Snippet: `readonly locale?: 'en' | 'sw' | 'sw-TZ' | 'lug';`
- Why medium: enum constrains valid locales — when EU/Asia rollout starts this file must be edited. Should reference a central `SUPPORTED_LOCALES` set from `packages/domain-models/src/common/region-config.ts`.

### MD-11..17 (bucketed): 119 hits of jurisdiction-tied union types
- Pattern: `type Jurisdiction = 'KE' | 'TZ' | 'UG' | ...` in 8+ packages
  - `packages/acquisition-advisor/src/types.ts:22`
  - `packages/central-intelligence/src/kernel/regulatory-mirror.ts:27`
  - `packages/central-intelligence/src/kernel/sub-mds/arrears-chaser/tools/draft-notice.ts:19`
  - `packages/central-intelligence/src/kernel/sub-mds/vendor-onboarding/tools/draft-msa.ts:14, :71, :104, :122, :129, :134, :141`
  - `packages/central-intelligence/src/kernel/sub-mds/vendor-onboarding/tools/verify-kyc.ts:12`
  - `packages/strategic-reports/src/types.ts:98`
  - `packages/central-intelligence/src/kernel/supervisor/types.ts:33`
- Why medium: union-typed strings duplicated 8+ places — should derive from one source: `packages/compliance-pack/src/types.ts:45-50` (already canonical) OR `packages/domain-models` `Jurisdiction` brand. New country = 8 edits today.
- Suggested fix: replace each local `type Jurisdiction` with `import type { Jurisdiction } from '@borjie/domain-models'`.

---

## AI / intelligence anti-patterns

### AI-1 (HIGH): Inconsistent default model names across critic/judge files
See MD-9 — promoted because divergent `DEFAULT_MODEL` constants across 4 files means model deprecation requires hunting. Already covered above; fix in same wave.

### AI-2 (MEDIUM): LLM JSON.parse without schema validation (6 sites)
- File: `packages/ai-copilot/src/services/maintenance-triage.ts:157` — `const parsed = JSON.parse(content);` (no zod)
- File: `packages/ai-copilot/src/services/nba-manager-queue.ts:461` — `const result = JSON.parse(content) as { actions: QueuedAction[] };` (cast, not parsed)
- File: `packages/ai-copilot/src/services/conversational-personalization.ts:520, :563` — same pattern (`as { … }`)
- File: `packages/ai-copilot/src/services/preference-profile-engine.ts:455` — same
- File: `packages/ai-copilot/src/services/friction-fingerprint-analyzer.ts:463, :517` — same
- File: `packages/ai-copilot/src/services/base-copilot.ts:345` — generic `JSON.parse(jsonStr) as T`
- Why: a malformed LLM response will pass through as the wrong shape and cause downstream runtime errors. The neighbouring files (`vendor-matcher.ts`, `risk-scoring.ts`, etc.) correctly use `SomeSchema.parse(JSON.parse(content))` — be consistent.
- Suggested fix: each site declares a zod schema and uses `.parse()` (NOT cast).

### AI-3 (MEDIUM): No per-call timeout on LLM calls outside `anthropic-client.ts`
- Spot-check: `packages/central-intelligence/src/kernel/sensors/anthropic-sensor.ts:167-273`, `packages/central-intelligence/src/kernel/critics/constitutional-critic.ts:274`, `packages/central-intelligence/src/kernel/counter-model/counter-model.ts:102` — all call `client.messages.create({...})` without a `signal` or `requestTimeout`.
- The wrapped `anthropic-client.ts:114` does set `timeout: config.timeout ?? 60_000` SDK-wide, so per-instance timeout is in place IF the caller uses that wrapper. The above sensor/critic files build clients via `getAnthropicClient(...)` — verify they all flow through the timeout wrapper. (Not verified in this read-only pass — flagged for follow-up.)
- Suggested fix: ensure every `messages.create({...})` call site either passes `signal: AbortSignal.timeout(X)` OR uses a wrapper that injects a timeout.

### AI-4 (MEDIUM): Echo brain fallback is logged but operator visibility is per-call (info+warn)
- File: `services/api-gateway/src/routes/ask/advisor-wiring.ts:102-110`
- Snippet: `logger.info('advisor-wiring: multi-LLM brain returned null — falling back to echo brain', ...)`
- Why: log is correct (not silent), but a single info-line per process startup is easy to miss. Should also emit a metric / page-the-operator event.
- Suggested fix: add `metric.increment('advisor.brain_fallback')` and set the SLO budget so the alert fires when fallback persists > 1 min.

### AI-5 (MEDIUM): Hardcoded `temperature` in prompts/default-prompts.ts is not annotated
- File: `packages/ai-copilot/src/prompts/default-prompts.ts:123, :269, :417, :564`
- Why: even though this file IS the prompt registry (per path), the temperature values (`0.3, 0.5, 0.6, 0.3`) lack `// reason:` comments — operator can't tune without guessing intent.
- Suggested fix: add `// reason: low temp because output is parsed as JSON` style annotations.

### AI-6 (MEDIUM): OpenAI client instantiated per-service-class (10 sites)
- Files: `packages/ai-copilot/src/services/vendor-matcher.ts:154`, `nba-manager-queue.ts:355`, `preference-profile-engine.ts:323`, `sentiment-analyzer.ts:150`, `friction-fingerprint-analyzer.ts:331`, `maintenance-triage.ts:113`, `conversational-personalization.ts:340`, `renewal-optimizer.ts:160`, `risk-scoring.ts:427`, `next-best-action.ts:155`
- Pattern: each constructor does `this.openai = new OpenAI({ apiKey: config.openaiApiKey });`
- Why: each instance opens its own connection pool. In a hot path that spawns multiple service classes per request this leaks file descriptors and skips circuit-breaker logic. Anthropic side correctly uses `anthropicSingleton` in `services/api-gateway/src/composition/sovereign.ts:134`.
- Suggested fix: introduce an `OpenAISingleton` (mirror `anthropicSingleton`) and inject via the service constructor.

---

## Recommended fix wave

Cluster the fix work into three phases so the follow-up agent can act mechanically:

### P50 — high-severity config-leak sweep
Auto-fix HI-1..HI-12 mechanically:
- Replace `process.env.X || 'literal'` with `requireEnv('X')` where the literal is a data value (not a sane sentinel like log-level).
- Source currency/jurisdiction from `tenantContext.*` in graph-tools, VP-finance, owner.financial_summary, and KRA filing.
- Drop deprecated OpenAI model literal `'gpt-4-turbo-preview'`.

Touches: `services/payments-ledger/`, `services/document-intelligence/`, `services/payments/mpesa/`, `services/api-gateway/middleware/auth.middleware.ts`, `packages/database/src/schemas/`, `packages/central-intelligence/src/kernel/{tools,sub-mds,vp-personas,tool-spec}/`, `packages/ai-copilot/src/{providers,prompts}/`.

### P51 — centralise jurisdiction / locale / currency types
Fix MD-11..17:
- Make `packages/domain-models` the single source of `Jurisdiction`, `LocaleTag`, `CurrencyCode`.
- Replace 8 duplicate union-type declarations with imports.

Touches: `packages/acquisition-advisor/`, `packages/central-intelligence/src/kernel/{regulatory-mirror,sub-mds,supervisor}/`, `packages/strategic-reports/`.

### P52 — central LLM-param + retry policy config
Fix MD-1..6, MD-9, AI-1, AI-5:
- Move every hardcoded `temperature`/`maxTokens`/`retries`/`attempts` to a typed config module.
- Reduce 4+ `DEFAULT_MODEL` constants to one import from `ANTHROPIC_MODELS`.
- Add a `// reason:` comment to every non-trivial numeric default.

Touches: `packages/ai-copilot/`, `packages/central-intelligence/`, `packages/observability/`, `services/notifications/`, `services/reports/`.

### P53 (optional) — observability hardening
Fix AI-2 (LLM JSON validation), AI-3 (timeout audit), AI-4 (echo-brain metric), AI-6 (OpenAI singleton).

---

## Out of scope (in-flight agent paths — re-audit after their commits land)

The following package paths are being actively rewritten by concurrent agents
(P41–P48). All scan results above were filtered to EXCLUDE them. Re-run this
audit once those agents land their commits:

- `packages/analytics/` (P41)
- `packages/forecasting/` (P42)
- `packages/knowledge-graph/` (P43)
- `packages/compliance-pack/` (P44)
- `packages/security-hardening/` (P45)
- `packages/document-ai/` (P46)
- `packages/progressive-intelligence/` (P47)
- `packages/document-quality-guarantor/` (P48)

The `document-ai/src/ocr/anthropic-vision-adapter.ts:34` literal `'claude-opus-4-7'` is the only intersection — flagged in MD-9 above for completeness but P50 must NOT touch that file until P46 lands.

---

## Scan methodology

All scans run from the repo root with `grep -rEn` against `*.ts` and `*.tsx`,
excluding `node_modules`, `dist`, `.next`, and the 8 in-flight package paths
above. Test files (`__tests__/`, `fixtures/`, `seeds/`, `*.test.ts`,
`*.spec.ts`) and the test-double directories were filtered out so all hits
above are production code.

Pattern list (transient `/tmp/audit-*.txt` files during the scan):
1. Secrets: `sk-ant-*`, `sk-*`, `AKIA[A-Z0-9]{16}`, `sk_live_*`, JWT `eyJ...`
2. Tenant-id leaks: `'trc-*'`, `tenantId: 'demo-*'`
3. Env fallbacks: `process.env.X || 'literal'`
4. Model names: `claude-[34]`, `gpt-[345]`, `opus-`, `sonnet-`, `haiku-`, `gemini-`, `deepseek-`
5. Jurisdictions / currencies: `'(TZ|KE|UG|RW|NG|ZA)'`, `'(TZS|KES|UGX|RWF|NGN|ZAR)'`
6. Fake brains: `createEchoBrain`, `EchoBrain`, `fakeBrain`, `mockBrain`, `stubBrain`
7. Inline prompts (heuristic): `(systemPrompt|prompt|messages):\s*['"\`].{200,}`
8. LLM params: `temperature: 0\.[0-9]+`, `top_p:`, `max_tokens:`, `maxTokens:`
9. Localhost URLs: `https?://(localhost|127\.0\.0\.1|internal\.|0\.0\.0\.0)`
10. Locales: `'(sw|en)-(TZ|KE|UG|RW|NG|ZA)'`
11. Retries: `(retries|maxRetries|attempts):\s*[1-9][0-9]?`

False-positive rate was high on patterns 2, 5, 7 — kind-strings like
`'tenant-app'`, `z.literal('TZ')` enum constraints, and Cypher
`MERGE (p)-[:HAS_UNIT*1..3]->(u)` matched the regex but are legitimate.
Manual triage filtered these out so the findings above are real risks.
