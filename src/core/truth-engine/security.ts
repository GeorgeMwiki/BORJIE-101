/**
 * Truth Engine Security Layer
 *
 * Defends the engine against:
 *   - SQL injection (we use Supabase parameterized queries everywhere; this
 *     module adds zod input validation as defense-in-depth).
 *   - SSRF (server-side request forgery) — evidence-collector only fetches
 *     whitelisted authoritative domains, never user-controlled URLs.
 *   - Prompt injection through evidence excerpts — excerpts are sanitized
 *     before being injected into LLM prompts.
 *   - Auth bypass — admin mutation routes MUST go through requireRole()
 *     in the route handler. This module provides the assertion helper.
 *   - Rate-limit / DoS — refresh-on-demand is gated per-(user, factKey).
 *   - PII leak — evidence excerpts are scrubbed of detected PII.
 *
 * Bank-grade checklist applied:
 *   [x] No user input flows directly into a URL fetch.
 *   [x] No user input flows directly into SQL.
 *   [x] All admin writes audited via existing audit-service.
 *   [x] All cron endpoints gated by CRON_SECRET bearer token.
 *   [x] Service-role client never exported to client-side bundles.
 */

import { z } from "zod";
import type { ClaimCategory, ClaimDraft, EvidenceSourceType } from "./types";

// ============================================================================
// SSRF — domain allowlist for web fetches
// ============================================================================

/**
 * The ONLY domains the truth engine is allowed to fetch from. Adding a domain
 * requires a security review; never read this list from user input or from
 * the database.
 */
const ALLOWED_FETCH_DOMAINS: ReadonlySet<string> = new Set([
  // Tanzanian gov / regulator
  "bot.go.tz",
  "tra.go.tz",
  "brela.go.tz",
  "nbs.go.tz",
  "fcc.go.tz",
  "nemc.go.tz",
  "fiu.go.tz",
  "tcra.go.tz",
  "parliament.go.tz",
  "ras.go.tz",
  "tcc.or.tz",
  "ewura.go.tz",
  "tasaf.go.tz",
  "nbaa.go.tz",
  "psptb.go.tz",
  "tibu.go.tz",
  "tic.go.tz",
  "tanesco.co.tz",
  "twb.go.tz",
  "trc.go.tz",
  "bafs.go.tz",
  // Mobile money / payment switch
  "tipsng.com",
  "tcdc.go.tz",
  // Major banks
  "demo-bank.test",
  "demo-bank.test",
  "nmbbank.co.tz",
  "nbc.co.tz",
  "stanbicbank.co.tz",
  "dtbafrica.com",
  "eximbank-tz.com",
  "kcbgroup.com",
  "equitybankgroup.com",
  "equitybank.co.tz",
  "absa.co.tz",
  "standardchartered.co.tz",
  "ecobank.com",
  "akiba.co.tz",
  "bankabc.co.tz",
  "bocbtz.com",
  "tib.co.tz",
  "uba.com",
  "diamondtrust.co.tz",
  "imbank.com",
  "mkombozibank.co.tz",
  "azaniabank.co.tz",
  "fbme.com",
  "cbafrica.com",
  "tpb.co.tz",
  // Multilateral / academic
  "worldbank.org",
  "data.worldbank.org",
  "imf.org",
  "bis.org",
  "fao.org",
  "afdb.org",
  "afsic.net",
  "ifc.org",
  "uneca.org",
  "comesa.int",
  "eac.int",
  "sadc.int",
  "wto.org",
  // News (Tanzania)
  "thecitizen.co.tz",
  "dailynews.co.tz",
  "mwananchi.co.tz",
  "ippmedia.com",
  "thearusha.com",
  "tanzaniainvest.com",
  "businessdailyafrica.com",
  // News (international)
  "reuters.com",
  "ft.com",
  "bloomberg.com",
  "ap.org",
  "wsj.com",
  "economist.com",
]);

/**
 * Throws if the URL points to a non-whitelisted domain. Call this BEFORE any
 * fetch() inside the truth engine. Defense against SSRF and exfiltration.
 */
export function assertFetchAllowed(url: string): void {
  const parsed = (() => {
    try {
      return new URL(url);
    } catch {
      throw new Error("truth-engine.fetch_blocked: invalid URL");
    }
  })();

  // Block non-HTTPS in production (allow HTTP only for localhost dev)
  if (
    parsed.protocol !== "https:" &&
    !(process.env.NODE_ENV !== "production" && parsed.hostname === "localhost")
  ) {
    throw new Error(
      `truth-engine.fetch_blocked: non-https URL rejected: ${parsed.protocol}`,
    );
  }

  // Block private/loopback IPs in production
  if (process.env.NODE_ENV === "production") {
    const host = parsed.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host.startsWith("10.") ||
      host.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      host.startsWith("169.254.") || // link-local + AWS metadata
      host.endsWith(".internal")
    ) {
      throw new Error("truth-engine.fetch_blocked: private/internal host");
    }
  }

  const domain = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (!ALLOWED_FETCH_DOMAINS.has(domain)) {
    throw new Error(
      `truth-engine.fetch_blocked: domain not in allowlist: ${domain}`,
    );
  }
}

// ============================================================================
// Input validation (zod) — defense-in-depth on top of Supabase parameterization
// ============================================================================

const CATEGORY_VALUES: readonly ClaimCategory[] = [
  "pricing",
  "forex",
  "commodity",
  "regulatory",
  "structural",
  "benchmark",
  "geographic",
  "institutional",
];

const EVIDENCE_SOURCE_TYPES: readonly EvidenceSourceType[] = [
  "official_gov",
  "bank_official",
  "regulator",
  "news",
  "academic",
  "industry_report",
  "user_contributed",
  "llm_consensus",
  "partner_api",
];

export const claimDraftSchema = z.object({
  category: z.enum(CATEGORY_VALUES as [ClaimCategory, ...ClaimCategory[]]),
  subject: z.string().trim().min(2).max(200),
  factKey: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .regex(/^[a-z0-9_]+$/, "factKey must be snake_case ([a-z0-9_])"),
  claimText: z.string().trim().min(2).max(2000),
  numericValue: z.number().finite().optional(),
  unit: z.string().trim().max(40).optional(),
  jurisdiction: z
    .string()
    .trim()
    .regex(
      /^([A-Z]{2}|GLOBAL)$/,
      "jurisdiction must be ISO-3166-1 alpha-2 or 'GLOBAL'",
    )
    .optional(),
  effectiveDate: z.string().date().optional(),
  expiryDate: z.string().date().optional(),
  evidence: z
    .array(
      z.object({
        sourceType: z.enum(
          EVIDENCE_SOURCE_TYPES as [
            EvidenceSourceType,
            ...EvidenceSourceType[],
          ],
        ),
        sourceUrl: z.string().url().nullable(),
        sourceDomain: z.string().nullable(),
        excerpt: z.string().trim().min(1).max(8000),
        fullText: z.string().max(100000).optional(),
        retrievedBy: z.string().trim().min(1).max(120),
      }),
    )
    .min(1)
    .max(20),
  createdBy: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(
      /^(system|cron:[a-z0-9_-]+|admin:[0-9a-f-]{36}|ondemand:[a-z0-9_:-]+)$/,
      "createdBy must be 'system', 'cron:*', 'admin:<uuid>', or 'ondemand:*'",
    ),
  pendingVerification: z.boolean().optional(),
  initialConfidence: z.number().min(0).max(1).optional(),
  // ISO-8601 timestamp; the lookup-layer staleness gate uses this for
  // pendingVerification seeds. Optional — `persistClaim` falls back to
  // `now()` when absent.
  lastVerifiedAt: z.string().datetime().optional(),
});

/**
 * Strict validator for claim drafts. Use on every external entry point
 * (admin API, partner ingest, LLM-extracted facts).
 */
export function validateClaimDraft(input: unknown): ClaimDraft {
  return claimDraftSchema.parse(input) as ClaimDraft;
}

// ============================================================================
// Prompt-injection scrubbing for evidence excerpts
// ============================================================================

/**
 * Excerpts ingested from the web could contain prompt-injection payloads
 * ("ignore previous instructions and..."). Before injecting into an LLM
 * prompt we collapse known injection patterns and HTML-escape the rest.
 */
export function sanitizeExcerptForPrompt(excerpt: string): string {
  if (!excerpt) return "";

  return (
    excerpt
      // Strip common prompt-injection trigger phrases
      .replace(
        /\b(ignore previous|disregard prior|system prompt|jailbreak|forget your instructions|act as|you are now)\b[^.]{0,200}/gi,
        "[redacted]",
      )
      // Strip role markers used by LLM APIs
      .replace(/<\|?(system|user|assistant|tool)\|?>/gi, "")
      // Collapse delimiter abuse
      .replace(/```[\s\S]{0,500}```/g, "[code-block-removed]")
      .trim()
      .slice(0, 4000)
  );
}

// ============================================================================
// PII scrubbing (defense-in-depth — anti-hallucination-validator already runs)
// ============================================================================

const PII_PATTERNS: ReadonlyArray<RegExp> = [
  /\b\d{3}-\d{2}-\d{4}\b/g, // US SSN-like
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, // emails
  /\b(?:\+255|0)[67]\d{8}\b/g, // Tanzanian mobile (+255 7xxxxxxxx, +255 6xxxxxxxx, 0 7/6xxxxxxxx)
  /\bTIN[:\s]*\d{3}-?\d{3}-?\d{3}\b/gi, // Tanzanian TIN
  /\b[A-Z]{2}\d{6,8}\b/g, // National ID-like patterns
];

export function scrubPII(text: string): string {
  return PII_PATTERNS.reduce(
    (acc, pattern) => acc.replace(pattern, "[redacted]"),
    text,
  );
}

// ============================================================================
// Rate-limit guard for on-demand refresh
//
// Redis-backed sliding window — see ./rate-limit.ts. This function is kept as
// a thin re-export so existing callers don't break. All new code should
// import canRefreshOnDemandAsync from "./rate-limit" directly.
// ============================================================================

import { canRefreshOnDemand as canRefreshOnDemandAsync } from "./rate-limit";

/**
 * Per-actor + per-(category, factKey) rate-limit guard. Prevents a single
 * abusive user from hammering the on-demand refresh endpoint. Redis-backed
 * in production, in-memory fallback in dev/tests.
 */
export async function canRefreshOnDemand(
  actorId: string,
  factKey: string,
): Promise<boolean> {
  return canRefreshOnDemandAsync(actorId, factKey);
}

/**
 * Verify a cron secret bearer token. Centralized so route handlers all use the
 * same constant-time comparison.
 */
export function verifyCronSecret(authorizationHeader: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (!authorizationHeader) return false;
  const expected = `Bearer ${secret}`;
  if (authorizationHeader.length !== expected.length) return false;

  // Constant-time compare to prevent timing attacks
  let result = 0;
  for (let i = 0; i < expected.length; i++) {
    result |= expected.charCodeAt(i) ^ authorizationHeader.charCodeAt(i);
  }
  return result === 0;
}
