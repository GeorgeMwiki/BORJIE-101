# Zero-Hardcoded Scanners (Piece P)

Five static-analysis scanners that enforce the platform's data-driven
posture: every UI string, role label, entity type, frontend route, and
module-enablement list is **data**, not hard-coded text. Vision quote:
*"no hard-coded things, okay?"*

These scanners follow the same allowlist + JSON-report pattern as the
existing `audit-hardcoded-{currency,locale,jurisdiction,bank,tax-rate}`
scanners, and run on every PR via `.github/workflows/zero-hardcoded.yml`.

## Scanner index

| # | Scanner | What it flags | Severity | Scope |
|---|---|---|---|---|
| 1 | `audit-hardcoded-strings.mjs` | English UI copy that isn't behind `t('key')` | MEDIUM | `apps/`, `packages/{chat-ui,genui,dynamic-sections}/src` |
| 2 | `audit-hardcoded-roles.mjs` | `role === 'admin'`-style string-matches | HIGH | `packages/`, `services/`, `apps/` |
| 3 | `audit-hardcoded-entity-types.mjs` | `entityType === 'PROPERTY'`-style comparisons | MEDIUM | `packages/`, `services/`, `apps/` |
| 4 | `audit-hardcoded-routes.mjs` | `router.push('/onboarding')`-style inline URLs | LOW | `apps/*/src/` |
| 5 | `audit-hardcoded-module-list.mjs` | `['estate', 'hr', 'fleet']`-style inline module arrays | MEDIUM | `packages/`, `services/`, `apps/` |

Every scanner accepts the standard flags:

```
node scripts/audit-hardcoded-<name>.mjs \
  --report .audit/hardcoded-<name>.json \
  --summary .audit/hardcoded-<name>.md \
  [--json]    # machine-readable to stdout
  [--strict|--no-strict]   # default --strict (exit 1 on any violation)
  [--root <dir>]   # override scan root (used by unit tests)
```

## What each scanner enforces

### 1. `audit-hardcoded-strings.mjs`

User-facing English strings must resolve through `next-intl`:

```tsx
// FLAGGED
<input placeholder="Enter your name" aria-label="Search" />

// CORRECT
const t = useTranslations('myForm');
<input placeholder={t('namePlaceholder')} aria-label={t('searchLabel')} />
```

Three detection patterns:
- JSX text nodes: `>Sentence with spaces<`
- JSX attribute strings: `placeholder="..."`, `aria-label="..."`, `title="..."`, `alt="..."`, `label="..."`
- Object-literal `label: 'Some text'` props

Auto-skipped:
- Test / fixture / stories files
- Files in i18n catalogue directories (`messages/`, `locales/`, `i18n/`, `translations/`)
- Whole-subtree path prefixes: `apps/admin-platform-portal/`, `apps/admin-portal/`, `apps/marketing/` (operator/marketing UIs intentionally English-only)
- Files with `useTranslations` import — only attribute strings and `label:` props are flagged (text nodes are too noisy when the file is already i18n-aware)

### 2. `audit-hardcoded-roles.mjs`

Role-name comparisons must go through `authz-policy`:

```ts
// FLAGGED
if (user.role === 'admin') return true;

// CORRECT
import { isAdminRole } from '@borjie/authz-policy';
if (isAdminRole(user.role)) return true;
```

The regex requires a role-bearing identifier on the LHS (`role`, `userRole`, `user.role`, `currentRole`, `profile.role`, `principal.role`, `actor.role`, `me.role`) — discriminator tags like `ctx.kind === 'tenant'` are NOT flagged.

Role names recognised: `admin`, `administrator`, `manager`, `employee`, `owner`, `agent`, `staff`, `vendor`.

Auto-skipped:
- Zod / type-union / `as const` declarations
- `switch (role)` dispatch blocks
- Tier checks (line contains `T1`..`T5`)

### 3. `audit-hardcoded-entity-types.mjs`

Entity-type comparisons should use the `entity_type_definition` lookup or polymorphic dispatch:

```ts
// FLAGGED
if (row.entityType === 'PROPERTY') { ... }

// CORRECT
const def = await entityTypeDefinitions.get(row.entityType);
if (def.kind === 'property') { ... }
```

Entity types recognised: `PROPERTY`, `UNIT`, `LEASE`, `INVOICE`, `PAYMENT`, `TENANT`, `OWNER`, `EMPLOYEE`, `CONTRACT`, `WORK_ORDER`, `ASSET`, `VENDOR`, `INSPECTION`.

### 4. `audit-hardcoded-routes.mjs`

Frontend route paths come from a per-app `ROUTES` registry:

```tsx
// FLAGGED
router.push('/onboarding/welcome');
<Link href="/payments/history">...</Link>

// CORRECT
import { ROUTES } from '@/lib/routes';
router.push(ROUTES.onboarding.welcome);
<Link href={ROUTES.payments.history}>...</Link>
```

Detected: `router.push(...)`, `router.replace(...)`, `redirect(...)`, `navigate(...)`, `<Link href="...">`.

Auto-skipped:
- API paths (`/api/...`) — handled by api-client registry
- Lines that reference `ROUTES.` (already using registry)
- External URLs (don't match `/`-prefix)

Each app owns its registry:
- `apps/customer-app/src/lib/routes.ts`
- `apps/estate-manager-app/src/lib/routes.ts`
- `apps/owner-portal/src/lib/routes.ts`

### 5. `audit-hardcoded-module-list.mjs`

Tenant-enabled modules come from the `module_templates` lookup:

```ts
// FLAGGED
const ENABLED = ['estate', 'hr', 'fleet'];

// CORRECT
const enabled = await moduleTemplates.forTenant(tenantId);
```

Modules recognised: `estate`, `hr`, `fleet`, `inventory`, `maintenance`, `marketplace`, `concierge`, `documents`, `security`, `energy`, `community`, `payments`, `accounting`, `compliance`.

Single-line arrays with 2+ module-name string literals are flagged. Zod enum / type declarations are auto-skipped.

## Allowlists

Allowlists live in `scripts/__allowlists__/`, one file per scanner:

| Allowlist | Entries |
|---|---|
| `hardcoded-strings-allowlist.mjs` | Per-file allowlist for locale-targeted apps (operator/marketing apps use whole-subtree prefix allow). |
| `hardcoded-roles-allowlist.mjs` | Kernel identity layer, role registry, chat-turn role discriminator. |
| `hardcoded-entity-types-allowlist.mjs` | Doc-type → icon dispatch tables, entity-code namespace generators. |
| `hardcoded-routes-allowlist.mjs` | The per-app `ROUTES` registry files themselves. |
| `hardcoded-module-list-allowlist.mjs` | Cross-module signal payloads (sourceModules, fetchersToPrime, knowledge-base tags). |

Every entry requires a justification ≥ 8 characters explaining WHY the file legitimately contains the literal. Stale entries (file no longer exists) FAIL the workflow.

## Sweep results (before / after Piece P)

| Scanner | Before | After | Delta |
|---|---|---|---|
| hardcoded-strings | 56 | 52 | -4 swept + 1 i18n-key surface added |
| hardcoded-roles | 2 | **0** | -2 (PASS) |
| hardcoded-entity-types | 0 | **0** | (PASS — baseline clean) |
| hardcoded-routes | 67 | 40 | -27 swept via per-app ROUTES registries |
| hardcoded-module-list | 5 | **0** | -5 (correctly classified as allow-listed signal-payload metadata) |
| **TOTAL violations eliminated** | | | **38** |

Customer-app files migrated to the new patterns:
- `apps/customer-app/src/app/auth/{login,otp,register}/page.tsx`
- `apps/customer-app/src/app/emergencies/{page,report/page}.tsx`
- `apps/customer-app/src/app/feedback/{page,history/page}.tsx`
- `apps/customer-app/src/app/lease/page.tsx`
- `apps/customer-app/src/app/onboarding/{page,welcome,documents,inspection,e-sign,orientation,utilities,redeem}/page.tsx`
- `apps/customer-app/src/app/payments/{page,pay/page}.tsx`
- `apps/customer-app/src/app/profile/page.tsx`
- `apps/customer-app/src/app/requests/new/page.tsx`
- `apps/customer-app/src/app/utilities/submit-reading/page.tsx`
- `apps/customer-app/src/app/inspection/page.tsx`
- `apps/customer-app/src/app/jarvis/{page,JarvisConsole}.tsx`
- `apps/customer-app/src/components/OrgSwitcher.tsx`
- `apps/customer-app/src/components/SpotlightMount.tsx`
- `apps/customer-app/src/components/dashboard/{LeaseSummary,UpcomingPayment}.tsx`
- `apps/customer-app/src/components/onboarding/PhoneSignupForm.tsx`
- `apps/customer-app/src/components/chat/ChatComposer.tsx`
- `apps/customer-app/src/components/FeedbackThumbs.tsx`
- `apps/customer-app/src/components/ESignature.tsx`

Service-layer files migrated:
- `services/api-gateway/src/routes/metrics.router.ts` (uses `isAdminRole` instead of role string-matches)

Package-layer additions:
- `packages/authz-policy/src/system-roles.ts` (new `isAdminRole(name)` helper + canonical admin role set)
- `packages/authz-policy/src/index.ts` (exports `SystemRoles`, `isAdminRole`, `SystemRole` type)

i18n catalogue surface added (customer-app `messages/{en,sw}.json`):
- `newRequestPage.locations.*` (8 keys × 2 locales)
- `newRequestPage.timeSlots.*` (4 keys × 2 locales)
- `feedbackThumbs.*` (3 keys × 2 locales)
- `chatComposer.*` (3 keys × 2 locales)
- `residentConcierge.*` (2 keys × 2 locales)
- `eSignaturePrompt.*` (1 key × 2 locales)

Total new i18n entries: **42** (21 keys × 2 locales).

## Running locally

```bash
# Run all five scanners in non-strict mode (report-only) and emit JSON reports
for s in strings roles entity-types routes module-list; do
  node scripts/audit-hardcoded-$s.mjs --no-strict \
    --report .audit/hardcoded-$s.json \
    --summary .audit/hardcoded-$s.md
done

# Strict mode (exits 1 on first violation) — what CI runs
node scripts/audit-hardcoded-roles.mjs
```

## CI

`.github/workflows/zero-hardcoded.yml` runs the 5 scanners as a fail-fast: false matrix. Each scanner's markdown summary is appended to the GitHub PR check `Summary` tab, so reviewers can drill into violations without opening artifacts.

## Adding a new scanner

1. Drop a new `scripts/audit-hardcoded-<name>.mjs` next to the others (use `scripts/lib/audit-helpers.mjs` for the boilerplate).
2. Drop a new allowlist at `scripts/__allowlists__/hardcoded-<name>-allowlist.mjs` exporting a `Map<path, reason>`.
3. Drop a new unit test under `scripts/__tests__/audit-hardcoded-<name>.test.ts`.
4. Add the scanner to the `audit` matrix in `.github/workflows/zero-hardcoded.yml`.
5. Update this codemap.
