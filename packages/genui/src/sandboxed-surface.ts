/**
 * SandboxedSurface — the MCP-Apps escape-hatch lane for GENUINELY NOVEL
 * surfaces the 35-primitive catalog + the portal-tab field/widget vocabulary
 * cannot express.
 *
 * The MD's PRIMARY actuation is composing vetted primitives (the AG-UI parts)
 * and incremental PortalTab patches. But some surfaces are irreducibly bespoke
 * — a custom interactive cadastre map widget, a third-party regulator-portal
 * embed, a one-off simulation canvas. For those, this lane mints a CSP-isolated
 * sandboxed iframe (the MCP "Apps"/ui-resource pattern), so the MD can ship a
 * novel surface WITHOUT a service redeploy and WITHOUT punching a hole in the
 * host's security model.
 *
 * Security posture (defense-in-depth — CLAUDE.md: no raw HTML interpolation,
 * no reflective CORS):
 *   - The iframe ALWAYS carries a restrictive `sandbox` attribute. The
 *     baseline is `allow-scripts` only; every extra token is opt-in and
 *     drawn from a strict allowlist. `allow-same-origin` + `allow-scripts`
 *     together is FORBIDDEN by construction (it would let the frame escape
 *     its sandbox), enforced at parse time.
 *   - A `csp` string is required and applied via a sandboxed-frame CSP so the
 *     embedded document cannot phone home to arbitrary origins.
 *   - postMessage from the frame is only honoured from `allowedMessageOrigins`
 *     (an explicit allowlist — never `'*'`). The host renderer enforces this.
 *   - The body is provided EITHER as `srcdoc` (inline HTML, rendered into a
 *     `srcdoc` iframe so it inherits an opaque origin) OR as a `src` URL on
 *     the host's vetted sandbox origin — never both.
 *
 * This module is PURE (no React, no DOM) so it is safe on the `@borjie/genui`
 * server entry. The React host lives in `./components/SandboxedSurfaceFrame.tsx`.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// 1. Sandbox token allowlist — the ONLY tokens a SandboxedSurface may set.
// ---------------------------------------------------------------------------

/**
 * The iframe `sandbox` tokens the MD is allowed to request. `allow-scripts`
 * is implicit (always applied) — a novel surface with no scripts would not
 * need this lane. Notably ABSENT: `allow-same-origin`, `allow-top-navigation`,
 * `allow-popups-to-escape-sandbox`, `allow-storage-access-by-user-activation`.
 */
export const SANDBOX_ALLOWED_TOKENS = [
  'allow-forms',
  'allow-popups',
  'allow-modals',
  'allow-downloads',
  'allow-pointer-lock',
  'allow-presentation',
] as const;

export type SandboxAllowedToken = (typeof SANDBOX_ALLOWED_TOKENS)[number];

const SandboxTokenSchema = z.enum(SANDBOX_ALLOWED_TOKENS);

// ---------------------------------------------------------------------------
// 2. Shared primitives
// ---------------------------------------------------------------------------

const Iso8601Schema = z
  .string()
  .min(1)
  .refine((s) => !Number.isNaN(Date.parse(s)), 'must be ISO-8601 parseable');

/**
 * An https origin (scheme + host + optional port) with NO path/query/hash —
 * the shape postMessage origins + frame `src` hosts take. `'*'` is rejected.
 */
const HttpsOriginSchema = z
  .string()
  .min(1)
  .max(300)
  .refine((value) => {
    if (value === '*') return false;
    try {
      const url = new URL(value);
      return (
        url.protocol === 'https:' &&
        url.pathname === '/' &&
        url.search === '' &&
        url.hash === ''
      );
    } catch {
      return false;
    }
  }, 'must be a bare https origin (no path/query/hash); "*" is forbidden');

// ---------------------------------------------------------------------------
// 3. The SandboxedSurface document.
// ---------------------------------------------------------------------------

export const SANDBOXED_SURFACE_SCHEMA_VERSION = 1;

/**
 * Base fields shared by both body variants. Split out so the discriminated
 * union below can attach the `srcdoc` XOR `src` invariant cleanly.
 */
const SandboxedSurfaceBaseShape = {
  id: z.string().min(1).max(120),
  version: z.literal(SANDBOXED_SURFACE_SCHEMA_VERSION),
  /** Tenant scope — always present (RLS pattern mirrors PortalTab). */
  tenantId: z.string().min(1).max(120),
  /** Stable key for routing / link-to (e.g. `cadastre.viewer`). */
  surfaceKey: z
    .string()
    .min(1)
    .max(120)
    .regex(
      /^[a-z][a-z0-9._-]*$/,
      'surface key must be lowercase letters / digits / . _ -',
    ),
  title: z.string().min(1).max(120),
  description: z.string().max(500),
  /**
   * Extra sandbox tokens beyond the implicit `allow-scripts`. Deduped +
   * allowlisted. Empty array = scripts only (the safest novel surface).
   */
  sandboxTokens: z.array(SandboxTokenSchema).max(SANDBOX_ALLOWED_TOKENS.length),
  /**
   * Content-Security-Policy applied to the embedded document. REQUIRED —
   * a novel surface with no CSP is rejected. Capped + must contain a
   * `default-src` directive so it is a real policy, not a placeholder.
   */
  csp: z
    .string()
    .min(1)
    .max(2000)
    .refine(
      (value) => /(^|;)\s*default-src\b/i.test(value),
      'csp must declare a default-src directive',
    ),
  /**
   * postMessage origins the host will accept messages FROM. Explicit
   * allowlist; `'*'` rejected. Empty = the frame may not message the host.
   */
  allowedMessageOrigins: z.array(HttpsOriginSchema).max(20),
  /** Render height in px (the frame is width-100%). 120..2000. */
  heightPx: z.number().int().min(120).max(2000),
  /** Provenance — the chat turn that minted this surface. */
  sourceConversationId: z.string().max(200).optional(),
  createdBy: z.string().min(1).max(120),
  createdAt: Iso8601Schema,
  updatedAt: Iso8601Schema,
} as const;

const SrcdocSurfaceSchema = z
  .object({
    ...SandboxedSurfaceBaseShape,
    body: z.literal('srcdoc'),
    /** Inline HTML rendered into a `srcdoc` iframe (opaque origin). */
    srcdoc: z.string().min(1).max(200_000),
  })
  .strict();

const SrcSurfaceSchema = z
  .object({
    ...SandboxedSurfaceBaseShape,
    body: z.literal('src'),
    /**
     * URL on the host's vetted sandbox origin. Must be https. The host
     * decides which origins are acceptable; this only enforces https +
     * a parseable URL so a `javascript:` / `data:` body cannot slip in.
     */
    src: z
      .string()
      .min(1)
      .max(2000)
      .refine((value) => {
        try {
          return new URL(value).protocol === 'https:';
        } catch {
          return false;
        }
      }, 'src must be an https URL'),
  })
  .strict();

/**
 * The full surface document — a `srcdoc` inline body XOR a `src` URL body.
 * The discriminator is `body`, so exactly one variant's payload is required.
 */
export const SandboxedSurfaceSchema = z
  .discriminatedUnion('body', [SrcdocSurfaceSchema, SrcSurfaceSchema])
  .superRefine((surface, ctx) => {
    // Defense-in-depth: `allow-same-origin` is not in the allowlist, but
    // re-assert the sandbox-escape invariant in case the allowlist ever
    // grows. allow-same-origin + allow-scripts ⇒ full escape.
    if ((surface.sandboxTokens as ReadonlyArray<string>).includes('allow-same-origin')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'allow-same-origin is forbidden — it defeats the sandbox when combined with scripts',
        path: ['sandboxTokens'],
      });
    }
  });

export type SandboxedSurface = z.infer<typeof SandboxedSurfaceSchema>;

// ---------------------------------------------------------------------------
// 4. Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the literal `sandbox` attribute value the host applies. Always
 * leads with `allow-scripts`; appends the (deduped, sorted) allowlisted
 * tokens. Pure — used by the React host AND by tests.
 */
export function computeSandboxAttr(
  surface: Pick<SandboxedSurface, 'sandboxTokens'>,
): string {
  const extra = Array.from(new Set(surface.sandboxTokens)).sort();
  return ['allow-scripts', ...extra].join(' ');
}

/** Defensive validate — returns the parsed surface or throws. */
export function parseSandboxedSurface(input: unknown): SandboxedSurface {
  return SandboxedSurfaceSchema.parse(input);
}

/** Non-throwing variant — returns `null` on schema failure. */
export function safeParseSandboxedSurface(
  input: unknown,
): SandboxedSurface | null {
  const result = SandboxedSurfaceSchema.safeParse(input);
  return result.success ? result.data : null;
}

/**
 * Is `origin` allowed to postMessage the host for this surface? The host's
 * `message` listener calls this with `event.origin`. Exact-match only —
 * never a prefix/suffix check (which would be a wildcard footgun).
 */
export function isMessageOriginAllowed(
  surface: Pick<SandboxedSurface, 'allowedMessageOrigins'>,
  origin: string,
): boolean {
  return surface.allowedMessageOrigins.includes(origin);
}
