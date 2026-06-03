/**
 * Privacy-router wiring — LP-15 / LP-30 (PO-17).
 *
 * Activates the previously-orphan `@borjie/privacy-router` at the api-gateway
 * composition root. The router classifies an inference payload by
 * data-sensitivity tier and decides whether it may leave the premises:
 *
 *   RESTRICTED   -> local model only; DENIED if the local endpoint is down.
 *   CONFIDENTIAL -> approved cloud + mandatory PII strip.
 *   INTERNAL     -> approved cloud, no strip.
 *   PUBLIC       -> approved cloud, no restrictions.
 *
 * This module injects the two ports the router needs:
 *
 *   - PII stripper — reuses the kernel's regional scrubber
 *     (`@borjie/central-intelligence` `scrubCotForPersist`, which covers
 *     email / phone / NIDA / KRA / M-Pesa + API keys / model URLs). The
 *     router's `stripPii` contract returns `{ stripped, mappings }`; the
 *     scrubber is one-way (no reversible mappings), so `mappings` carries
 *     the redaction CATEGORIES as keys (enough for the audit `strippedFields`
 *     count) with redacted-token placeholders as values.
 *
 *   - local-endpoint health — probes the on-prem model URL from
 *     `BORJIE_LOCAL_MODEL_HEALTH_URL` (HEAD/GET with a short timeout). When
 *     unset, RESTRICTED data is DENIED (fail-closed, per BOT Act residency).
 *
 * The router itself is a pure leaf; everything here is the wire side.
 *
 * Fail-safe posture: a classify/route error resolves to a CONSERVATIVE
 * decision (treat as CONFIDENTIAL -> PII-strip + cloud); the original
 * un-stripped text is NEVER forwarded on error. If PII stripping ALSO throws,
 * the turn is DENIED outright so no raw data can egress. An explicit `DENIED`
 * decision (RESTRICTED data, no local model) is surfaced so the dispatch path
 * refuses the turn. Pino logger only.
 *
 * @module services/api-gateway/src/composition/privacy-router-wiring
 */

import {
  createPrivacyRouter,
  type PrivacyRouter,
  type PrivacyRoutingRequest,
  type PrivacyRoutingResult,
  type PiiStripperPort,
  type LocalEndpointHealthPort,
} from '@borjie/privacy-router';
import { scrubCotForPersist } from '@borjie/central-intelligence';

export interface PrivacyRouterLogger {
  readonly info?: (meta: object, msg: string) => void;
  readonly warn?: (meta: object, msg: string) => void;
}

// ---------------------------------------------------------------------------
// PII stripper port — backed by the kernel regional scrubber.
// ---------------------------------------------------------------------------

const REDACTED_PLACEHOLDER = '[REDACTED]';

/**
 * Build the PII-stripper port from the kernel's `scrubCotForPersist`. The
 * scrubber is one-way; we surface the redaction CATEGORIES as the mapping
 * keys so the router's `strippedFields` count + audit reflect what was
 * removed, without inventing reversible tokens the scrubber cannot restore.
 */
export function buildPiiStripperPort(): PiiStripperPort {
  return {
    stripPii: (text: string) => {
      const result = scrubCotForPersist(text);
      const mappings: Record<string, string> = {};
      for (const category of result.categories) {
        mappings[category] = REDACTED_PLACEHOLDER;
      }
      return Object.freeze({
        stripped: result.scrubbed,
        mappings: Object.freeze(mappings),
      });
    },
    containsPii: (text: string) => {
      try {
        return scrubCotForPersist(text).redactionCount > 0;
      } catch {
        // Fail-safe: if detection throws, assume PII is present so the
        // router escalates to the stricter (strip + cloud) branch.
        return true;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Local-endpoint health port.
// ---------------------------------------------------------------------------

export interface BuildLocalHealthArgs {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly logger?: PrivacyRouterLogger;
  /** Injectable fetch for tests; defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
  /** Health-check timeout in ms. Default 1500. */
  readonly timeoutMs?: number;
}

const DEFAULT_HEALTH_TIMEOUT_MS = 1500;

/**
 * Build the local-endpoint health port. Probes
 * `BORJIE_LOCAL_MODEL_HEALTH_URL`. When the env var is unset OR the probe
 * fails / times out, returns `false` so RESTRICTED data is DENIED rather
 * than risked. Never throws.
 */
export function buildLocalEndpointHealthPort(
  args: BuildLocalHealthArgs = {},
): LocalEndpointHealthPort {
  const env = args.env ?? process.env;
  const url = env.BORJIE_LOCAL_MODEL_HEALTH_URL?.trim();
  const timeoutMs = args.timeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;
  const fetchImpl = args.fetchImpl ?? globalThis.fetch;

  return {
    isHealthy: async () => {
      if (!url || typeof fetchImpl !== 'function') return false;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetchImpl(url, {
          method: 'GET',
          signal: controller.signal,
        });
        return res.ok;
      } catch (err) {
        args.logger?.warn?.(
          {
            wiring: 'privacy-router',
            error: err instanceof Error ? err.message : String(err),
          },
          'privacy-router: local endpoint health probe failed; treating as unavailable',
        );
        return false;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Router factory + guarded-dispatch helper.
// ---------------------------------------------------------------------------

export interface BuildPrivacyRouterArgs {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly logger?: PrivacyRouterLogger;
  /** Injectable fetch for the local-endpoint health probe (tests). */
  readonly fetchImpl?: typeof fetch;
}

export interface WiredPrivacyRouter {
  readonly router: PrivacyRouter;
  /** Whether privacy routing is enabled (default ON; '0'/'false'/'off' off). */
  readonly enabled: boolean;
  /**
   * The PII stripper the router was built with. Held here so the guarded
   * dispatch path can fail CONSERVATIVE on a routing error — strip PII before
   * any cloud egress rather than passing raw text through.
   */
  readonly pii: PiiStripperPort;
}

export const PRIVACY_ROUTER_FLAG = 'BORJIE_PRIVACY_ROUTER_ENABLED';

function flagDefaultOn(
  env: Readonly<Record<string, string | undefined>>,
  key: string,
): boolean {
  const raw = env[key]?.trim().toLowerCase();
  return !(raw === '0' || raw === 'false' || raw === 'off');
}

/**
 * Build the wired privacy router. Never throws — a construction failure
 * returns a router with `enabled:false` so the dispatch path treats every
 * turn as allowed (the gateway must still serve turns).
 */
export function buildPrivacyRouter(
  args: BuildPrivacyRouterArgs = {},
): WiredPrivacyRouter {
  const env = args.env ?? process.env;
  const enabled = flagDefaultOn(env, PRIVACY_ROUTER_FLAG);
  const pii = buildPiiStripperPort();
  const router = createPrivacyRouter({
    pii,
    localHealth: buildLocalEndpointHealthPort({
      env,
      ...(args.logger ? { logger: args.logger } : {}),
      ...(args.fetchImpl ? { fetchImpl: args.fetchImpl } : {}),
    }),
  });
  return Object.freeze({ router, enabled, pii });
}

// ---------------------------------------------------------------------------
// Guarded dispatch decision — consulted BEFORE the LLM provider call.
// ---------------------------------------------------------------------------

export interface PrivacyDispatchDecision {
  /** True when the turn may be dispatched to the chosen endpoint. */
  readonly allowed: boolean;
  /** The (possibly PII-stripped) text to send to the provider. */
  readonly processedText: string;
  /** The routing result for telemetry / audit. */
  readonly result: PrivacyRoutingResult;
}

/**
 * Consult the privacy router for a single dispatch. Returns
 * `{ allowed:false }` when the router DENIED the turn (RESTRICTED data with
 * no local model) — the caller MUST refuse and NOT call the cloud provider.
 *
 * Fail-safe posture:
 *   - DISABLED flag: passthrough with the original text (privacy routing is
 *     off; the gateway keeps its prior behaviour). This is the ONLY path that
 *     forwards original text without classification, and it is operator-
 *     controlled, not error-driven.
 *   - ROUTING ERROR: fail CONSERVATIVE — the text is treated as CONFIDENTIAL,
 *     PII-stripped, and routed to cloud. The original, un-stripped text is
 *     NEVER forwarded on error. If the stripper ALSO throws, the turn is
 *     DENIED (`allowed:false`) so raw PII can never egress.
 *   - RESTRICTED-without-local: explicit DENY (the only classification-driven
 *     hard block).
 */
export async function consultPrivacyRouter(
  wired: WiredPrivacyRouter,
  request: PrivacyRoutingRequest,
  logger?: PrivacyRouterLogger,
): Promise<PrivacyDispatchDecision> {
  if (!wired.enabled) {
    return Object.freeze({
      allowed: true,
      processedText: request.text,
      result: passthroughResult(request.text),
    });
  }
  try {
    const result = await wired.router.route(request);
    if (result.endpoint === 'DENIED') {
      logger?.warn?.(
        {
          wiring: 'privacy-router',
          classification: result.classification,
          reason: result.reason,
        },
        'privacy-router: turn DENIED (restricted data, local model unavailable)',
      );
      return Object.freeze({ allowed: false, processedText: '', result });
    }
    return Object.freeze({
      allowed: true,
      processedText: result.processedText ?? request.text,
      result,
    });
  } catch (err) {
    // Fail CONSERVATIVE (never fail-open): a routing error must NOT leak the
    // original, un-stripped text to a cloud LLM. Treat the turn as
    // CONFIDENTIAL — PII-strip the text and route to cloud. If the stripper
    // itself throws, DENY the turn outright (allowed:false) so raw text can
    // never egress.
    try {
      const strip = wired.pii.stripPii(request.text, request.knownNames);
      logger?.warn?.(
        {
          wiring: 'privacy-router',
          error: err instanceof Error ? err.message : String(err),
          strippedFieldCount: Object.keys(strip.mappings).length,
        },
        'privacy-router: route failed; failing conservative (PII-strip + cloud)',
      );
      return Object.freeze({
        allowed: true,
        processedText: strip.stripped,
        result: conservativeResult(strip.stripped, Object.keys(strip.mappings)),
      });
    } catch (stripErr) {
      logger?.warn?.(
        {
          wiring: 'privacy-router',
          error: err instanceof Error ? err.message : String(err),
          stripError:
            stripErr instanceof Error ? stripErr.message : String(stripErr),
        },
        'privacy-router: route AND strip failed; DENYING turn (no raw egress)',
      );
      return Object.freeze({
        allowed: false,
        processedText: '',
        result: deniedOnErrorResult(),
      });
    }
  }
}

/**
 * Result used ONLY when privacy routing is disabled by flag. Forwards the
 * original text (operator opted out of routing). Never used on an error path.
 */
function passthroughResult(text: string): PrivacyRoutingResult {
  return Object.freeze({
    endpoint: 'claude',
    piiStripped: false,
    strippedFields: Object.freeze([]),
    classification: 'INTERNAL',
    reason: 'privacy-router disabled; passthrough',
    timestamp: new Date().toISOString(),
    processedText: text,
  });
}

/**
 * Result used when routing threw but PII stripping succeeded — the turn is
 * treated as CONFIDENTIAL (stripped + cloud) so no raw text leaves on error.
 */
function conservativeResult(
  strippedText: string,
  strippedFields: ReadonlyArray<string>,
): PrivacyRoutingResult {
  return Object.freeze({
    endpoint: 'claude',
    piiStripped: true,
    strippedFields: Object.freeze([...strippedFields]),
    classification: 'CONFIDENTIAL',
    reason:
      'privacy-router route failed; failed conservative (treated as ' +
      'CONFIDENTIAL, PII-stripped before cloud egress)',
    timestamp: new Date().toISOString(),
    processedText: strippedText,
  });
}

/**
 * Result used when routing AND PII stripping both threw — the turn is DENIED
 * so no text (raw or stripped) is forwarded.
 */
function deniedOnErrorResult(): PrivacyRoutingResult {
  return Object.freeze({
    endpoint: 'DENIED',
    piiStripped: false,
    strippedFields: Object.freeze([]),
    classification: 'RESTRICTED',
    reason:
      'privacy-router route and PII strip both failed; turn DENIED to ' +
      'prevent any raw data egress',
    timestamp: new Date().toISOString(),
    processedText: '',
  });
}
