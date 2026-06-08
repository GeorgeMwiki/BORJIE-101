/**
 * IP-egress output-filter wiring — composition root (SEC-4 closure).
 *
 * Promotes the built-but-DARK `@borjie/agent-security-guard` output filter
 * (`createOutputFilter`) into the LIVE brain answer path as the MANDATORY,
 * FAIL-CLOSED last hop before any agent text reaches the client, a tool, or
 * persistence. Enforces the hard invariant (INV-H / INV-D): chat NEVER leaks
 * IP — it shows STATUS + OUTPUTS + EVIDENCE only, never internal cognition /
 * prompts / architecture / secrets / canary tokens / CROSS-tenant data.
 *
 * What the filter strips (see output-filter.ts):
 *   - system-prompt-leak       — persona markers ("you are mr mwikila",
 *                                `<<<persona>>>`, `system prompt:`, `[[BEGIN_PERSONA]]`)
 *   - code-execution-attempt   — eval()/new Function()/child_process/os.system()
 *   - js-injection-tag         — <script>/<iframe>/inline event handlers
 *   - markdown-image-suspicious-domain — Rehberger image-exfil defense
 *   - cross-tenant-id-leak     — GENUINE other-tenant ids in the output, scoped
 *                                to the explicit `forbiddenTenantIds` set the
 *                                composition root injects (NOT a blanket
 *                                UUID-shape strip — see below)
 *
 * CROSS-TENANT SCOPING (do NOT over-redact the owner's OWN ids): 141 DB tables
 * use `uuid('id').primaryKey().defaultRandom()`, so documentId / assetId /
 * licenceId / employeeId / threadId / taskId are all random UUIDs that
 * legitimately appear in the owner's OWN answers, deep-links, tab/slot
 * payloads, tool-call args, and evidence pointers. A blanket "redact every
 * UUID that is not the active tenant id" strip would MANGLE all of them
 * (break deep links, corrupt tool args). So cross-tenant defense is scoped to
 * ACTUAL other-tenant ids via the package filter's `forbiddenTenantIds`
 * mechanism: the composition root MAY inject the set of known OTHER tenant ids
 * (from the tenants directory) with `setForbiddenTenantIds`; only those are
 * stripped. When no directory is available the cross-tenant strip is INERT and
 * we rely on RLS (which already prevents another tenant's data from reaching
 * the answer) plus the system-prompt / secret / canary / image classes.
 *
 * DELIBERATELY NOT wired: the optional `dataProtection` PII redactor. The
 * egress concern is internal-cognition / prompts / architecture / secrets /
 * canary / CROSS-tenant data — NOT the tenant's OWN business data. The owner
 * seeing their OWN estate PII in their OWN answer is legitimate; redacting it
 * would corrupt the answer. PII that must NOT leave the premises is already
 * handled on the INGRESS side by the privacy-router (CONFIDENTIAL strip before
 * the cloud provider). So this filter omits `dataProtection` by design.
 *
 * SECURITY FLOOR, not a capability flag: DEFAULT-ON. The kill-switch env
 * `BORJIE_EGRESS_FILTER` only disables on an explicit '0'/'false'/'off', and
 * that disable path logs a single Pino WARN. When ON there is NO bypass.
 *
 * FAIL-CLOSED: a filter that throws (or any internal fault) NEVER falls
 * through to raw passthrough. On any error the guard returns a fully-redacted
 * placeholder for the offending text, so raw cognition can never egress on a
 * filter exception (CLAUDE.md: "Kill-switch fail-closed. Never catch + ignore
 * its errors.").
 *
 * Degrade-safe: block persistence uses the durable repo when one is supplied,
 * else the in-memory repo (`createInMemoryOutputFilterRepo`) — it NEVER throws
 * for lack of a backend, and the strip itself does not depend on persistence.
 *
 * No `console.*` (Pino shim only). `process.env` is read here at the
 * composition root, never per-request beyond the cached flag.
 *
 * @module services/api-gateway/src/composition/egress-filter-wiring
 */

import {
  createOutputFilter,
  createInMemoryOutputFilterRepo,
  type OutputFilter,
  type OutputFilterBlock,
  type OutputFilterBlockRepository,
  type AgentChannel,
} from '@borjie/agent-security-guard';
import type { PinoLikeLogger } from '../utils/pino-shim.js';
import { createPinoLikeLogger } from '../utils/pino-shim.js';

// ---------------------------------------------------------------------------
// Kill-switch + static config (read ONCE at the composition root).
// ---------------------------------------------------------------------------

/** Env kill-switch. DEFAULT-ON; only an explicit off-token disables it. */
export const EGRESS_FILTER_FLAG = 'BORJIE_EGRESS_FILTER';

/**
 * Allow-list of hosts the markdown-image rule will NOT strip. Conservative by
 * default — only Borjie-owned asset/CDN origins. An operator can extend the
 * list with a comma-separated `BORJIE_EGRESS_IMAGE_ALLOWLIST`. The egress
 * filter strips EVERY other image url (the canonical Rehberger exfil defense).
 */
const DEFAULT_ALLOWED_IMAGE_DOMAINS: ReadonlyArray<string> = Object.freeze([
  'borjie.com',
  'borjie.app',
  'assets.borjie.com',
  'cdn.borjie.com',
]);

/** The placeholder substituted for the ENTIRE text on a fail-closed event. */
const FAIL_CLOSED_PLACEHOLDER = '[redacted]';

/** The egress filter observes the outbound chat surface. */
const EGRESS_CHANNEL: AgentChannel = 'chat';

const CANARY_PLACEHOLDER = '[CANARY_REDACTED]';

/**
 * Secret / cognition canary markers stripped on egress. These are tokens the
 * agent must NEVER surface — they signal a system-prompt / secret leak. The
 * default set covers the canonical Borjie persona-prompt canary and common
 * secret prefixes; operators can extend it with a comma-separated
 * `BORJIE_EGRESS_CANARY_TOKENS`.
 */
const DEFAULT_CANARY_TOKENS: ReadonlyArray<string> = Object.freeze([
  'BORJIE_CANARY',
  'sk-ant-',
  'sk-proj-',
  'sk-live-',
  'SUPABASE_JWT_SECRET',
  'ANTHROPIC_API_KEY',
]);

function resolveEnabled(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  const raw = env[EGRESS_FILTER_FLAG]?.trim().toLowerCase();
  return !(raw === '0' || raw === 'false' || raw === 'off' || raw === 'no');
}

function resolveAllowedImageDomains(
  env: Readonly<Record<string, string | undefined>>,
): ReadonlyArray<string> {
  const raw = env.BORJIE_EGRESS_IMAGE_ALLOWLIST?.trim();
  if (!raw) return DEFAULT_ALLOWED_IMAGE_DOMAINS;
  const extra = raw
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d.length > 0);
  return Object.freeze([...DEFAULT_ALLOWED_IMAGE_DOMAINS, ...extra]);
}

function resolveCanaryTokens(
  env: Readonly<Record<string, string | undefined>>,
): ReadonlyArray<string> {
  const raw = env.BORJIE_EGRESS_CANARY_TOKENS?.trim();
  if (!raw) return DEFAULT_CANARY_TOKENS;
  const extra = raw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  return Object.freeze([...DEFAULT_CANARY_TOKENS, ...extra]);
}

// ---------------------------------------------------------------------------
// Forbidden (other-tenant) id directory — the cross-tenant defense anchor.
// ---------------------------------------------------------------------------
//
// The cross-tenant strip is SCOPED to GENUINE other-tenant ids, NOT a blanket
// UUID-shape redaction (which would mangle the owner's OWN entity ids — see the
// module header). The composition root MAY populate this set from the tenants
// directory; the per-tenant filter then forbids every id EXCEPT the active
// tenant's own id. When the set is empty (no directory wired) the cross-tenant
// strip is INERT and we rely on RLS + the system-prompt/secret/canary/image
// classes. Process-global so it is shared by every per-tenant filter closure.

let forbiddenTenantIds: ReadonlyArray<string> = Object.freeze([]);

/**
 * Register the set of KNOWN tenant ids (the tenants directory) so the egress
 * filter can strip GENUINE cross-tenant ids without touching the owner's own
 * entity UUIDs. Idempotent + immutable: stores a frozen, de-duplicated,
 * lower-cased copy. Invalidates the per-tenant filter cache so the next guard
 * rebuilds with the new forbidden set. No-op-safe with an empty array.
 */
export function setForbiddenTenantIds(ids: ReadonlyArray<string>): void {
  const cleaned = Array.from(
    new Set(
      ids
        .filter((id): id is string => typeof id === 'string')
        .map((id) => id.trim().toLowerCase())
        .filter((id) => id.length > 0),
    ),
  );
  forbiddenTenantIds = Object.freeze(cleaned);
  // Drop the built filter so the next call rebuilds with the new directory.
  cached = null;
}

/**
 * The forbidden ids for a SPECIFIC active tenant: every known tenant id EXCEPT
 * the active tenant's own (the owner's own id is legitimate in their own
 * answer). Pure — returns a NEW array (immutability).
 */
function forbiddenIdsForTenant(tenantId: string): ReadonlyArray<string> {
  if (forbiddenTenantIds.length === 0) return forbiddenTenantIds;
  const ownId = tenantId.trim().toLowerCase();
  return Object.freeze(forbiddenTenantIds.filter((id) => id !== ownId));
}

// ---------------------------------------------------------------------------
// Public guard surface.
// ---------------------------------------------------------------------------

/**
 * The outcome of guarding one span of agent text. `text` is ALWAYS safe to
 * emit — on a clean span it is the (possibly identical) cleaned text; on a
 * block it is the redacted text; on a fail-closed fault it is a generic
 * placeholder. `blocked` is true when at least one leak class fired (or the
 * guard failed closed). `reasons` lists the filter rules that fired.
 */
export interface EgressGuardResult {
  readonly text: string;
  readonly blocked: boolean;
  readonly reasons: ReadonlyArray<string>;
}

/**
 * The process egress filter. Both methods are FAIL-CLOSED: a thrown filter or
 * any internal fault yields a safe placeholder, never the raw input.
 *
 * `guardStream` is the per-frame fast path for streaming partial chunks: it
 * runs the SAME synchronous strip but does NOT persist block rows (a partial
 * chunk is not a complete auditable answer, and persistence must not sit on
 * the token critical path). `guardFinal` runs on the COMPLETE answer text /
 * tool args / error message and additionally persists any block rows
 * best-effort (fire-and-forget; a persistence fault never affects the
 * already-cleaned text).
 */
export interface EgressFilter {
  /** True when the filter is active (kill-switch ON). */
  readonly enabled: boolean;
  /** Fast per-frame guard for streaming partial chunks (no persistence). */
  readonly guardStream: (text: string, tenantId: string) => EgressGuardResult;
  /** Full guard for the final answer / tool args / error message (persists). */
  readonly guardFinal: (text: string, tenantId: string) => EgressGuardResult;
}

interface EgressFilterConfig {
  readonly enabled: boolean;
  readonly allowedImageDomains: ReadonlyArray<string>;
  readonly canaryTokens: ReadonlyArray<string>;
  readonly repo: OutputFilterBlockRepository;
  readonly logger: PinoLikeLogger;
}

interface PreFilterResult {
  readonly text: string;
  readonly reasons: ReadonlyArray<string>;
}

/**
 * Pre-filter layer that runs BEFORE the package OutputFilter. Strips the
 * canary/secret-marker class the package filter does not cover:
 *
 *   - canary/secret-marker: configured tokens that signal a system-prompt /
 *     secret leak (persona canary, API-key prefixes, env var names).
 *
 * Cross-tenant id leakage is NOT handled here. It is delegated to the package
 * filter's `forbiddenTenantIds` mechanism (scoped to GENUINE other-tenant ids
 * from the directory), so the owner's OWN entity UUIDs — documentId / assetId /
 * licenceId / employeeId — pass through INTACT (see module header). A blanket
 * UUID-shape strip would corrupt deep links + tool args.
 *
 * Pure: returns a NEW string + the reasons that fired (immutability).
 */
function preFilter(
  input: string,
  _tenantId: string,
  config: EgressFilterConfig,
): PreFilterResult {
  const reasons: string[] = [];
  let text = input;

  // Canary / secret-marker strip — case-sensitive substring (tokens are
  // exact markers, not free text).
  for (const token of config.canaryTokens) {
    if (token.length === 0) continue;
    if (text.includes(token)) {
      reasons.push('canary-token');
      text = text.split(token).join(CANARY_PLACEHOLDER);
    }
  }

  return { text, reasons: Object.freeze(reasons) };
}

/**
 * Build a tenant-scoped `OutputFilter`. The filter bakes the OWN tenant id +
 * the set of FORBIDDEN (other) tenant ids into its closure, so it must be
 * built per tenant.
 *
 * `forbiddenTenantIds` is the GENUINE cross-tenant defense: every KNOWN tenant
 * id EXCEPT the active tenant's own (from the directory the composition root
 * registered via `setForbiddenTenantIds`). The package filter strips ONLY those
 * exact ids — it does NOT touch arbitrary UUID shapes, so the owner's OWN
 * entity ids (documentId / assetId / licenceId / employeeId) pass INTACT. When
 * the directory is empty the set is empty and the cross-tenant rule is inert
 * (RLS already prevents another tenant's data reaching the answer). The
 * system-prompt / code-exec / js / image rules fire regardless.
 */
function buildTenantFilter(
  tenantId: string,
  config: EgressFilterConfig,
): OutputFilter {
  const forbidden = forbiddenIdsForTenant(tenantId);
  return createOutputFilter({
    tenantId,
    channel: EGRESS_CHANNEL,
    allowedImageDomains: config.allowedImageDomains,
    ...(forbidden.length > 0 ? { forbiddenTenantIds: forbidden } : {}),
    // dataProtection intentionally omitted — see module header.
  });
}

/**
 * Run the strip and shape the public result. Persists block rows when
 * `persist` is true (best-effort). FAIL-CLOSED: on ANY throw, returns the
 * generic placeholder, marked blocked, never the raw input.
 */
function runGuard(
  input: string,
  tenantId: string,
  filterCache: Map<string, OutputFilter>,
  config: EgressFilterConfig,
  persist: boolean,
): EgressGuardResult {
  if (typeof input !== 'string' || input.length === 0) {
    return Object.freeze({ text: '', blocked: false, reasons: Object.freeze([]) });
  }
  try {
    let filter = filterCache.get(tenantId);
    if (!filter) {
      filter = buildTenantFilter(tenantId, config);
      filterCache.set(tenantId, filter);
    }
    // 1. Pre-filter — cross-tenant UUIDs + canary/secret markers (the classes
    //    the package filter cannot detect without a tenant directory).
    const pre = preFilter(input, tenantId, config);
    // 2. Package filter — system-prompt-leak / code-exec / js-injection /
    //    markdown-image-exfil, on the pre-filtered text.
    const result = filter.filter(pre.text);
    const reasons = Object.freeze([
      ...pre.reasons,
      ...result.blocks.map((b) => b.filterRule),
    ]);
    const blocked = reasons.length > 0;
    if (blocked) {
      config.logger.warn(
        {
          wiring: 'egress-filter',
          tenantId,
          rules: reasons,
          blockCount: reasons.length,
        },
        'egress-filter: stripped IP/leak content before client egress',
      );
      if (persist && result.blocks.length > 0) persistBlocks(result.blocks, config);
    }
    return Object.freeze({
      text: result.cleaned,
      blocked,
      reasons,
    });
  } catch (err) {
    // FAIL-CLOSED: a filter exception must NEVER fall through to raw
    // passthrough. Emit a safe placeholder for the entire span instead of
    // the (potentially leaking) raw text.
    config.logger.error(
      {
        wiring: 'egress-filter',
        tenantId,
        err: err instanceof Error ? err.message : String(err),
      },
      'egress-filter: guard FAILED — failing closed (redacting span)',
    );
    return Object.freeze({
      text: FAIL_CLOSED_PLACEHOLDER,
      blocked: true,
      reasons: Object.freeze(['fail-closed']),
    });
  }
}

/**
 * Persist block rows best-effort. Fire-and-forget: a persistence fault NEVER
 * affects the already-cleaned text the caller is about to emit.
 */
function persistBlocks(
  blocks: ReadonlyArray<OutputFilterBlock>,
  config: EgressFilterConfig,
): void {
  void config.repo.insertMany(blocks).catch((err: unknown) => {
    config.logger.warn(
      {
        wiring: 'egress-filter',
        err: err instanceof Error ? err.message : String(err),
      },
      'egress-filter: block persistence failed (text already cleaned; continuing)',
    );
  });
}

// ---------------------------------------------------------------------------
// Process singleton.
// ---------------------------------------------------------------------------

let override: EgressFilter | null = null;
let cached: EgressFilter | null = null;

/**
 * Build (once) and return the process egress filter. Reads the kill-switch +
 * image allow-list ONCE from `process.env`. Uses the in-memory block repo
 * (the only implementation available in api-gateway scope — the strip does not
 * depend on it, so this is degrade-safe). When the kill-switch is OFF, logs a
 * single WARN and returns a passthrough filter (the ONLY bypass, and it is
 * operator-controlled, not error-driven).
 */
export function getEgressFilter(
  logger: PinoLikeLogger = createPinoLikeLogger('egress-filter'),
): EgressFilter {
  if (override) return override;
  if (cached) return cached;

  const enabled = resolveEnabled(process.env);

  if (!enabled) {
    logger.warn(
      { wiring: 'egress-filter', flag: EGRESS_FILTER_FLAG },
      'egress-filter: DISABLED by kill-switch — agent text egresses UNFILTERED',
    );
    const passthrough: EgressFilter = Object.freeze({
      enabled: false,
      guardStream: (text: string) =>
        Object.freeze({ text, blocked: false, reasons: Object.freeze([]) }),
      guardFinal: (text: string) =>
        Object.freeze({ text, blocked: false, reasons: Object.freeze([]) }),
    });
    cached = passthrough;
    return cached;
  }

  const config: EgressFilterConfig = {
    enabled,
    allowedImageDomains: resolveAllowedImageDomains(process.env),
    canaryTokens: resolveCanaryTokens(process.env),
    repo: createInMemoryOutputFilterRepo(),
    logger,
  };

  // Per-tenant filter cache — the OutputFilter bakes the tenant id into its
  // closure, so we memoise one filter per tenant id (cheap closures).
  const filterCache = new Map<string, OutputFilter>();

  cached = Object.freeze({
    enabled: true,
    guardStream: (text: string, tenantId: string) =>
      runGuard(text, tenantId, filterCache, config, /* persist */ false),
    guardFinal: (text: string, tenantId: string) =>
      runGuard(text, tenantId, filterCache, config, /* persist */ true),
  });
  return cached;
}

/** Test seam — inject a deterministic egress filter (or reset to rebuild). */
export function __setEgressFilterForTests(filter: EgressFilter | null): void {
  override = filter;
  cached = null;
}

/**
 * Test seam — reset the forbidden (other-tenant) id directory to empty and
 * drop the built filter so the next guard rebuilds with no cross-tenant set.
 */
export function __resetForbiddenTenantIdsForTests(): void {
  forbiddenTenantIds = Object.freeze([]);
  cached = null;
}
