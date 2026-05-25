# Wave 25 — Agent W: Accessibility (a11y) scrub

**Scope:** `apps/admin-portal`, `apps/owner-portal`, `apps/customer-app`, `apps/estate-manager-app`.
**Method:** grep for each a11y gap class, fix in place, keep changes minimal, add en + sw translations for every new user-facing string.

## Per-app summary (counts of issues hit per class)

| Class | admin-portal | owner-portal | customer-app | estate-manager-app |
|---|---|---|---|---|
| Icon-only `<button>` without `aria-label` | 0 (close X in RolesPage etc. already labelled via parent heading; NOT fixed — flagged) | 2 fixed (WorkOrderDetailModal, CoOwnerInviteModal) | 2 fixed (PhotoCapture, BottomNavWithAction) + 1 already OK | 2 fixed (AttachmentUpload, DualSignOff) |
| `<img>` with no/hardcoded-English `alt` | 0 | 0 (all already translated) | 7 fixed (OnboardingPage x3, PhotoCapture, ESignature, e-sign, documents, FeedCard x2, VendorCard) | 0 (already translated) |
| Custom clickable `<div>` instead of `<button>` | 3 (modal backdrops — see "Flagged") | 5 (modal backdrops — see "Flagged") | 0 | 2 (modal backdrops — see "Flagged") |
| Modal focus-trap + Escape-to-close | 0 custom Esc handlers; no focus-trap anywhere (flagged) | added `role="dialog"` + `aria-modal` to 2 modals | — | added `role="dialog"` + `aria-modal` to DualSignOff |
| `:focus-visible` global style | **added** (`src/index.css`) | **added** (`src/index.css`) | **added** (`src/app/globals.css`) | **added** (`src/app/globals.css`) |
| Skip-link (`Skip to main content`) | **added** in `components/Layout.tsx` | **added** in `components/Layout.tsx` | **added** in `components/layout/AppShell.tsx` | **added** in `providers/AppShell.tsx` |
| `aria-live` on toast/alert | already widespread (73 files — mostly in existing polite regions) | already widespread | already widespread | already widespread |

Typecheck: **all 4 apps green** (`pnpm --filter <app> typecheck` clean).

## Fixed this wave

### Translation files (added new `a11y` namespace in both `en.json` + `sw.json`)

- `apps/customer-app/messages/en.json` + `sw.json` — added `a11y` namespace (15 keys: skipToMain, closeModal, removePhoto, authorAvatar, feedImage, vendorImage, uploadPreview, idFront, idBack, selfie, signaturePreview, documentPreview, like, comment, share, bookmark).
- `apps/estate-manager-app/messages/en.json` + `sw.json` — added `a11y` namespace (5 keys: skipToMain, closeModal, removePhoto, attachmentPreview, signaturePreview).
- `apps/owner-portal/messages/en.json` + `sw.json` — added `a11y` namespace (5 keys: skipToMain, closeModal, evidencePhoto, messageAttachment, signaturePreview).
- `apps/admin-portal/messages/en.json` + `sw.json` — added `a11y` namespace (2 keys: skipToMain, closeModal).

### Global focus-visible + skip-link CSS (4 files)

- `apps/admin-portal/src/index.css` — added `:focus-visible` outline + `.skip-link` class.
- `apps/owner-portal/src/index.css` — same.
- `apps/customer-app/src/app/globals.css` — same (uses Spotify-green to match brand).
- `apps/estate-manager-app/src/app/globals.css` — same (uses sky-blue theme).

### Skip-link integration (4 files, one per app)

- `apps/admin-portal/src/components/Layout.tsx` — `<a href="#main-content" className="skip-link">` at top of shell; `<main id="main-content" tabIndex={-1}>` on the main element. `tA11y = useTranslations('a11y')` added.
- `apps/owner-portal/src/components/Layout.tsx` — same pattern.
- `apps/customer-app/src/components/layout/AppShell.tsx` — skip-link + wrapped children in `<main id="main-content" tabIndex={-1}>`.
- `apps/estate-manager-app/src/providers/AppShell.tsx` — skip-link + wrapped children in `<main id="main-content" tabIndex={-1}>`.

### Image alt-text fixes (customer-app)

- `apps/customer-app/src/screens/OnboardingPage.tsx` — `alt="ID Front"` / `"ID Back"` / `"Selfie"` replaced with `alt={tA11y('idFront' | 'idBack' | 'selfie')}`. Added `tA11y` hook.
- `apps/customer-app/src/components/requests/PhotoCapture.tsx` — `alt="Upload"` replaced with `alt={tA11y('uploadPreview')}`. The X remove button now has `aria-label={tA11y('removePhoto')}` and icon is `aria-hidden`.
- `apps/customer-app/src/components/ESignature.tsx` — `alt="Signature"` replaced with `alt={tA11y('signaturePreview')}`. Added `useTranslations('next-intl')` import + hook.
- `apps/customer-app/src/app/onboarding/e-sign/page.tsx` — `alt="Signature"` replaced with `alt={tA11y('signaturePreview')}`.
- `apps/customer-app/src/app/onboarding/documents/page.tsx` — `alt="Document preview"` replaced with `alt={tA11y('documentPreview')}`.
- `apps/customer-app/src/components/feed/FeedCard.tsx` — author avatar `alt=""` → `alt={tA11y('authorAvatar', { name })}` (avatar now meaningfully identifies the person), feed image `alt=""` → `alt={tA11y('feedImage')}`, and the 4 icon-only action buttons (Like/Comment/Share/Bookmark) now have `aria-label` + `aria-hidden` on the icons.
- `apps/customer-app/src/components/marketplace/VendorCard.tsx` — `alt=""` → `alt={\`${name} — ${tA11y('vendorImage')}\`}` with `useTranslations` import.

### Icon-only button aria-label additions

- `apps/customer-app/src/components/BottomNav.tsx` — the center `BottomNavWithAction` action button (`<ActionIcon />` inside `<button>`) now has `aria-label={actionLabel}` + icon is `aria-hidden`.
- `apps/customer-app/src/components/feed/FeedCard.tsx` — Like, Comment, Share, Bookmark icon buttons now all have `aria-label` + `aria-hidden` icons (see above).

### Modal dialog semantics (minimal — role + aria-modal + labelled close)

- `apps/owner-portal/src/components/WorkOrderDetailModal.tsx` — outer container `role="dialog" aria-modal="true" aria-labelledby="wo-modal-title"`; backdrop `aria-hidden="true"`; title `<h2 id="wo-modal-title">`; close X now has `type="button"` + `aria-label={tA11y('closeModal')}`; icon `aria-hidden="true"`.
- `apps/owner-portal/src/components/CoOwnerInviteModal.tsx` — same treatment; `aria-labelledby="co-owner-invite-title"`; close button labelled.
- `apps/estate-manager-app/src/components/work-orders/DualSignOff.tsx` — same treatment; `aria-labelledby="dual-signoff-title"`; close `×` now has `type="button"` + `aria-label`.

### Estate-manager estate-manager AttachmentUpload X button

- `apps/estate-manager-app/src/components/maintenance/AttachmentUpload.tsx` — X remove button now has `aria-label={tA11y('removePhoto')}`; icon `aria-hidden`. Added `useTranslations` hook.

## Flagged for deeper refactor (NOT jammed in — reason)

### F1 — No modal focus-trap anywhere in the codebase

None of the hand-rolled modals (`WorkOrderDetailModal`, `CoOwnerInviteModal`, `DualSignOff`, `ConfirmDialog`, DocumentsPage version-history modal, RolesPage create-role modal, OperationsPage decision modal, SettingsPage invite modal, FinancialPage transaction modal, estate-manager `WorkOrderDetail` vendor modal, `onboarding/documents` quality-check modal, and ~15 more) trap focus or restore focus on close. Keyboard users Tab-ing through a modal will eventually tab *out of it* onto hidden-but-focusable elements behind the scrim. Similarly, **no custom Escape-key handler** closes any of these.

**Why not fixed in this wave:** adding a safe focus-trap requires either (a) a shared `<Modal>` wrapper component with `useFocusTrap` + `useEscapeKey` hooks, or (b) migrating to Radix `<Dialog>` / Headless UI `<Dialog>`. Either path is a cross-cutting refactor affecting 20+ files and is too large for an attribute-level a11y sweep. Recommendation: spawn a follow-up task "Introduce shared `<Modal>` primitive with focus-trap + Escape", then migrate the list of modals above to it.

### F2 — Modal backdrops are clickable `<div>`s, not `<button>`s

Every modal uses `<div className="fixed inset-0 bg-black/50" onClick={onClose} />` as the backdrop. Screen readers don't announce these as interactive, and they have no keyboard equivalent (Escape doesn't close — see F1). Fixing this correctly = refactor into a shared Modal primitive (see F1), so flagging here rather than forcing a per-file change.

Files affected: `apps/owner-portal/src/pages/DocumentsPage.tsx` (x2), `SettingsPage.tsx`, `FinancialPage.tsx`, `components/WorkOrderDetailModal.tsx`, `components/CoOwnerInviteModal.tsx`; `apps/admin-portal/src/pages/RolesPage.tsx` (x2), `OperationsPage.tsx`, `pages/roles/ApprovalMatrix.tsx`; `apps/estate-manager-app/src/components/work-orders/DualSignOff.tsx`, `screens/work-orders/WorkOrderDetail.tsx`.

Once F1's shared Modal lands, F2 disappears automatically.

### F3 — Color contrast: not audited in this pass

Requires a browser + contrast-ratio tool (or axe-core CLI). No obvious offenders spotted in the patterns I reviewed (most bodies use `text-gray-700`+ on white, or `text-white` on `slate-900`/`bg-primary-600`, both >= 4.5:1). Spot-check candidates for later: `text-slate-400` on `bg-slate-900` in admin-portal sidebar secondary labels (close to 4.5 but not verified), and `text-gray-500` on `bg-gray-50` toast text if any.

### F4 — `ApprovalMatrix` clickable card header (admin-portal)

`apps/admin-portal/src/pages/roles/ApprovalMatrix.tsx:238` is `<div className="... cursor-pointer" onClick={toggleExpand(rule.id)}>`. Should be `<button>`. Leaving for refactor pass — changing the tag risks layout regressions in the flex row's child markup.

### F5 — Form inputs: broad coverage OK, not exhaustively audited

A random sample of forms (`CoOwnerInviteModal`, `MaintenancePage`, `OnboardingPage`) all use `<label className="label">…</label>` + sibling `<input>` — textually associated but **not** `htmlFor`/`id`-linked in every case (react-hook-form `register` produces matching `name` attrs, not matching `id`s). This is a pattern-wide issue. A safe bulk-fix requires a codemod (add `htmlFor={fieldName} + id={fieldName}` pairs). Flagging as a separate refactor task.

## Skipped (with reason)

- **`<X className="h-3 w-3" />` inside icon-buttons whose parent `<label>` / `<h2>` already provides context** (e.g. `<label><X/></label>` in the FileInput drop zones — the label text labels the whole card). Not duplicating label.
- **All `<img>` sites where `alt={caption}` or `alt={filename}` was already correctly driven by user data** — `AttachmentUpload`, `WorkOrderDetailModal` evidence, `MessagesPage` attachments, inspection `conduct` meter photo (`alt={t('meterAlt', { type })}`), e-signature img, owner `ESignature`, login/register MFA QR. These already had the right pattern and translation.
- **Marketing / landing pages in customer-app** (`for-owners`, `for-tenants`, `for-managers`, `for-station-masters`, `pricing`, `how-it-works`, `compare`) — no `<img>` tags. Skip-link still reaches them via `AppShell` wrapper.
- **`apps/customer-app/src/app/onboarding/inspection/page.tsx:590` + `apps/estate-manager-app/src/app/inspections/[id]/conduct/page.tsx:447`** — both are inspection evidence photos with `alt=""`. In each case the photo sits next to a visible caption of the condition rating + notes, so it is correctly *decorative relative to the surrounding labelled context*. WCAG H67 allows `alt=""` when the image's information is already conveyed adjacently. Left as-is.
- **`borjie_app` (Flutter)** — outside scope.

## Typecheck results

```
pnpm --filter admin-portal typecheck       -> OK (no errors)
pnpm --filter owner-portal typecheck       -> OK (no errors, after fixing one stray-tag regression during the Modal edit)
pnpm --filter customer-app typecheck       -> OK (no errors)
pnpm --filter estate-manager-app typecheck -> OK (no errors)
```

## Summary

- **4/4 apps** got `:focus-visible` + `.skip-link` base styles.
- **4/4 apps** got a wired Skip-to-main-content link with proper `<main id="main-content" tabIndex={-1}>` target.
- **4/4 apps** got a new `a11y` translation namespace in both `en.json` + `sw.json`.
- **~15 image + icon-button + modal callsites** fixed individually.
- **5 class-level gaps** flagged as needing shared-primitive refactor (F1–F5), not jammed in as per constraint "do NOT rewrite whole components".

The biggest remaining a11y gap is the absence of a shared Modal primitive with focus-trap + Escape — recommended as its own dedicated task.
