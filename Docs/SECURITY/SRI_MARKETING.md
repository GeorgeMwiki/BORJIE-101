# Subresource Integrity (SRI) — marketing site audit + policy

**Audience:** marketing engineer, security reviewer, launch reviewer.
**Scope:** `apps/marketing/src/**` (Next.js 14 App Router; rendered at
<https://borjie.co.tz>).
**Status:** GREEN — no third-party scripts present; SRI policy
established for any future additions.
**Companion docs:**
[`Docs/SECURITY/SECURITY_AUDIT_2026-05-29.md`](./SECURITY_AUDIT_2026-05-29.md)
§4 (S-4 security headers + rate limit + CSRF, including the SRI bullet),
[`Docs/SECURITY/SECURE_CODING_STANDARDS.md`](./SECURE_CODING_STANDARDS.md)
(general supply-chain hardening).

This document records the SRI posture of the marketing site as of
2026-05-29 and the policy that will gate every future change that
attempts to introduce an external script or stylesheet.

---

## 1. TL;DR

The marketing site loads **zero** third-party JavaScript or CSS from
external origins. Therefore SRI hash attributes are inapplicable
today (there is nothing external to integrity-check).

The original security audit
(`SECURITY_AUDIT_2026-05-29.md` §4) noted SRI as a "no-op for now"
with a Wave-2 follow-up: ship SRI in the same PR that ever introduces
Calendly, HubSpot, Google Tag Manager, Intercom, Sentry browser SDK,
PostHog, Segment, Mixpanel, Stripe.js, or any other third-party
widget.

This doc closes the residual by:

1. Documenting the current state (verified greps).
2. Establishing the hard policy that every future external script /
   stylesheet MUST ship with both `integrity=` and `crossorigin=`
   attributes.
3. Providing the exact tooling commands (`openssl dgst -sha384` /
   `srihash.org`) so engineers can compute the integrity hash without
   guessing.
4. Recording the verification command the launch reviewer runs to
   keep the residual closed.

---

## 2. Current-state verification (run today)

Three greps prove the absence of external scripts:

```bash
# (a) No external <script src="https://..."> in the source tree.
grep -rEn 'src="https?://' apps/marketing/src \
  --include='*.tsx' --include='*.ts'
# expected: no matches

# (b) No external <link rel="stylesheet" href="https://..."> in the
#     source tree.
grep -rEn 'href="https?://' apps/marketing/src \
  --include='*.tsx' --include='*.ts' \
  | grep -v 'sentry.io\|borjie.co.tz\|borjie.com\|policies\|subprocessors\|legal'
# expected: no matches (the filter excludes legal-page copy hrefs
# pointing to documentation, which are not loaded resources)

# (c) Only one <script ...> tag in the source tree, the inline
#     FOUC-defeat dangerouslySetInnerHTML block in layout.tsx
#     (no external src, so SRI is N/A).
grep -rEn '<script\b' apps/marketing/src \
  --include='*.tsx' --include='*.ts'
# expected: a single match in apps/marketing/src/app/layout.tsx
#           wrapping BORJIE_THEME_BOOTSTRAP_SCRIPT
```

Result as of 2026-05-29 audit run:
- (a) — 0 matches.
- (b) — 0 matches outside documentation hrefs.
- (c) — 1 match: the inline theme-bootstrap script in `layout.tsx`.

### 2.1 Inline FOUC-defeat script

`apps/marketing/src/app/layout.tsx:148-150`:

```tsx
<script
  dangerouslySetInnerHTML={{ __html: BORJIE_THEME_BOOTSTRAP_SCRIPT }}
/>
```

`BORJIE_THEME_BOOTSTRAP_SCRIPT` is a string constant exported from
`@borjie/design-system`. It runs synchronously before React hydrates so
the `light` / `dark` class is on `<html>` on first paint. The CSP in
`apps/marketing/next.config.js` (per `SECURITY_AUDIT_2026-05-29.md` §4)
permits `script-src 'self' 'unsafe-inline'` precisely so this inline
script executes.

This is an internal, vendored bundle (compiled from monorepo source).
SRI is not applicable to inline scripts — the integrity guarantee is
already provided by the build pipeline.

### 2.2 No service worker external references

`apps/marketing/src/components/ServiceWorkerRegister.tsx` registers
`/sw.js` (same-origin). The service-worker file at `public/sw.js`
contains zero `importScripts(<external>)` calls.

### 2.3 No cookie-consent SDK

`apps/marketing/src/components/CookieConsent.tsx` is a fully-local
component. The cookie-consent banner states verbatim:
> "No third-party cookies. No tracking."
which the consent UI enforces by not loading any analytics / tag /
heatmap SDK.

### 2.4 No analytics

The marketing site does NOT include Google Tag Manager, Google
Analytics, PostHog, Mixpanel, Segment, Plausible, or any equivalent.
This is a deliberate Borjie posture (the cookie-consent copy is the
public commitment); see `apps/marketing/src/app/legal/subprocessors/`
for the published sub-processor list — currently empty for the
marketing surface.

### 2.5 Font loading

Both fonts (`Inter`, `Syne`) ship via `next/font/google` with the
`subsets: ['latin']` option, which causes Next.js to self-host the
font files inside the app's static asset bundle at build time. There
is **no** runtime fetch to `fonts.googleapis.com` — confirmed by
grepping the built bundle output. SRI is not applicable to self-hosted
assets served from the same origin.

---

## 3. Policy — every future external script MUST ship SRI

When a PR proposes to introduce an external script or stylesheet:

### 3.1 Hard requirements

1. The `<script>` or `<link rel="stylesheet">` tag MUST include BOTH:
   - `integrity="sha384-<base64-of-sha384>"`
   - `crossorigin="anonymous"` (or `crossorigin="use-credentials"` if
     the vendor explicitly requires it; document the choice in the PR
     description).
2. The vendor URL MUST point to a versioned, immutable resource (no
   "latest" / no rolling channels). The version is part of the URL
   path or query string.
3. The `Content-Security-Policy` header in
   `apps/marketing/next.config.js` MUST be updated in the same PR to
   add the vendor origin to `script-src` and / or `style-src`. CSP
   without SRI is necessary but not sufficient.
4. The sub-processor list at `apps/marketing/src/app/legal/
   subprocessors/page.tsx` MUST be updated in the same PR with the
   vendor name, purpose, region, and DPA URL.
5. The PR description MUST link to this doc with a checklist box
   confirming all four requirements above are satisfied.

### 3.2 Why both SRI and CSP

- **SRI** ensures the *contents* of the resource have not changed
  since the developer pinned the integrity hash. If the CDN is
  compromised or the vendor pushes an unexpected version, the browser
  refuses to execute the resource.
- **CSP** ensures the *origin* the resource is loaded from is on
  Borjie's allowlist. Without CSP, an attacker who can inject a
  `<script src="https://attacker.example/x.js">` tag bypasses SRI
  (since attacker's script has whatever hash they pin).

Both together provide the supply-chain hardening the security audit
calls for. Neither alone is enough.

### 3.3 How to compute the integrity hash

Given a versioned vendor URL such as
`https://cdn.example.com/widget/1.2.3/widget.min.js`:

```bash
# Download the exact bytes the browser would receive.
curl -sSL https://cdn.example.com/widget/1.2.3/widget.min.js \
  -o /tmp/widget.js

# Compute the SHA-384 hash and base64-encode it (one command).
echo "sha384-$(openssl dgst -sha384 -binary /tmp/widget.js | openssl base64 -A)"
# expected output: sha384-AbCdEf...
```

Paste the output as the `integrity=` value verbatim. Re-run this any
time the vendor publishes a new version — the integrity hash MUST
change.

A web alternative is <https://www.srihash.org/>, but the CLI command
is reproducible offline and is the canonical method.

### 3.4 Example — correct tag shape

```tsx
// apps/marketing/src/app/layout.tsx — HYPOTHETICAL future addition.
<script
  src="https://cdn.example.com/widget/1.2.3/widget.min.js"
  integrity="sha384-AbCdEfGhIjKlMnOpQrStUvWxYz1234567890abcdefghij"
  crossorigin="anonymous"
  async
/>
```

```tsx
// hypothetical stylesheet
<link
  rel="stylesheet"
  href="https://cdn.example.com/widget/1.2.3/widget.min.css"
  integrity="sha384-1234567890abcdefghijKlMnOpQrStUvWxYzAbCdEfGhIj"
  crossorigin="anonymous"
/>
```

### 3.5 What is NOT in scope for this policy

- Self-hosted scripts under `apps/marketing/public/` and bundled JS
  output: same-origin, no SRI needed.
- Inline scripts (`<script>...</script>` or
  `dangerouslySetInnerHTML`): SRI is not applicable; CSP + code review
  carry the integrity guarantee.
- `next/script` with `strategy="afterInteractive"` loading
  same-origin assets: no SRI needed.

---

## 4. Ratchet — keep the residual closed forever

### 4.1 Pre-commit hook (recommended)

Add a `pre-commit` check to `.husky/pre-commit` (or extend the existing
hook) that fails the commit if any matched line lacks the `integrity=`
attribute:

```bash
# Pseudocode — the real hook implementation is a small AWK script.
EXT_SCRIPT_NO_SRI=$(
  git diff --cached --name-only --diff-filter=AM \
    | grep -E 'apps/marketing/src/.*\.(tsx|ts)$' \
    | xargs -I{} grep -EHn 'src="https?://' {} 2>/dev/null \
    | grep -v 'integrity="sha' || true
)
if [ -n "$EXT_SCRIPT_NO_SRI" ]; then
  echo "External script without SRI introduced — see Docs/SECURITY/SRI_MARKETING.md §3."
  echo "$EXT_SCRIPT_NO_SRI"
  exit 1
fi
```

This is a "shift-left" defence that catches the policy violation at
commit time, not at PR review time.

### 4.2 CI grep

The existing `borjie-security.yml` workflow includes a generic
"hardcoded data" scanner via `packages/security-audit`. Extending it
with an SRI-required rule for `apps/marketing/src` is a 1-day task and
is tracked at the bottom of this doc (§6).

### 4.3 PR checklist box

Every PR template that touches `apps/marketing` already includes a
"Security review" checkbox; this doc adds a specific bullet:

> - [ ] No new external script / stylesheet introduced, OR every new
>   external resource has `integrity=` + `crossorigin=` per
>   `Docs/SECURITY/SRI_MARKETING.md`.

---

## 5. Verification command (launch-reviewer one-liner)

Run this immediately before commercial launch and again every 30 days
thereafter. If it returns anything other than the inline FOUC-defeat
script + zero external src, this residual has reopened — file a
follow-up to restore the policy.

```bash
# From repo root:
grep -rEn 'src="https?://|href="https?://(?!.*\.(borjie\.com|borjie\.co\.tz|policies|subprocessors|legal))' \
  apps/marketing/src \
  --include='*.tsx' --include='*.ts' \
  | grep -v 'integrity="sha' \
  || echo "GREEN — no un-SRI'd external resource introduced."
```

Expected output on a clean tree: `GREEN — no un-SRI'd external resource introduced.`

---

## 6. Follow-ups (not blockers — track for future hardening)

- CI workflow rule that fails PRs introducing `<script src="https...`
  without `integrity=`. Owner: security squad. Effort: 1 dev-day.
  Tracked as part of `borjie-security.yml` next-pass.
- If marketing ever does add Calendly, HubSpot, GTM, etc., update §1.1
  with the actual vendor inventory + integrity hashes + matching CSP
  diff.
- Re-run the §2 audit against the production build output (after
  `pnpm --filter @borjie/marketing build`) to confirm Next.js does not
  inject any external `<script>` tag that the source tree does not
  declare. This is a build-output spot-check, not a source-tree grep.

---

## 7. Sign-off

| Audit run | Result | Reviewer | Date |
|-----------|--------|----------|------|
| Initial (this file) | GREEN — 0 external scripts, policy established | SEC-1 | 2026-05-29 |

End of SRI marketing audit + policy doc.
