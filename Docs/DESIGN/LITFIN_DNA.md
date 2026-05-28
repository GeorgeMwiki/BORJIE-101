# LitFin DNA — applied to Borjie

**Last updated:** 2026-05-28
**Maintainer:** Borjie design-system maintainers (`packages/design-system`)
**Reference snapshot:** LitFin private repo, navigated read-only.

## Why this document exists

Borjie shares cultural DNA with LitFin — both are Stripe-/Linear-grade,
Africa-first, bilingual operating systems with one hero color sat on a
calm canvas, an editorial display face, generous whitespace, hairline
borders, and no slop (no orbs, no "Revolutionize" copy, no AI-glow
overuse). The user has repeatedly asked us to **mirror LitFin's feel
and looks** across every surface — not just headline pages, but
secondary panels, auth flows, modals, drawers, empty states, toasts,
loading skeletons, kbd hints, breadcrumbs, the lot.

This file is the canonical reference any designer/dev consults before
adding or polishing a surface. Each section cites the LitFin source
file (so we can re-verify) **and** the equivalent Borjie token /
primitive (so we can apply it without inventing).

The two products differ in one explicit way: **LitFin's hero color is
copper-orange (`oklch(0.60 0.14 45)` ≈ `#C46B2C`)**, while **Borjie's
hero color is warm gold (`#FFC857`)** sat on **navy slate
(`#0B0F19`)**. Do **not** introduce LitFin orange anywhere in Borjie.
Borjie palette = navy + gold + cream.

---

## 1. Color system

### Borjie ramp (canonical)

| Role | Token | Hex (dark) | OKLCH (dark) | When to use |
|------|-------|------------|--------------|-------------|
| Canvas | `--background` | `#0B0F19` | `oklch(0.146 0.025 270)` | Body, app shell, full-page surfaces |
| Card | `--card` / `--surface` | `#11151F` | `oklch(0.183 0.018 270)` | Cards, side panels, popovers |
| Raised surface | `--surface-raised` | `#161B27` | `oklch(0.210 0.018 270)` | Tooltips, dropdowns, sticky bars |
| Hairline border | `--border` | `#1E2330` | `oklch(0.250 0.014 270)` | Card outline, divider, input border |
| Strong border | `--border-strong` | `#2A3040` | `oklch(0.323 0.016 270)` | Hover-state border, focus ring base |
| Body text | `--foreground` | `#F5F5F0` | `oklch(0.959 0.014 88)` | Default text |
| Muted text | `--muted-foreground` | `#A0A4B0` | `oklch(0.706 0.015 261)` | Captions, meta, labels |
| **Hero gold** | `--signal-500` / `--primary` | `#FFC857` | `oklch(0.846 0.157 81)` | One-and-only brand signal, CTAs, focus rings, active nav indicator |
| Gold hover | `--signal-400` | `#F5B23E` | `oklch(0.792 0.156 73)` | Button hover, link underline-grow |
| Gold deep | `--signal-700` | `#B27520` | `oklch(0.580 0.131 67)` | Wordmark gradient endpoint |
| Success emerald | `--success` | `#2EBD85` | `oklch(0.700 0.158 161)` | Up-trend, completed step, all-clear |
| Danger red | `--danger` | `#E14B4B` | `oklch(0.620 0.197 25)` | Failure, destructive CTA, critical alert |
| Info / warning gold | `--info` / `--warning` | `#FFC857` | same as hero | Borjie collapses info+warning into the signal gold; differentiation is by iconography not color |

Tokens live at `packages/design-system/src/styles/globals.css:38-247`.
Light mode mirror at `:root` (lines 38-158), dark at `.dark` (lines
166-246).

### LitFin equivalents (for reference only)

LitFin uses copper `#C46B2C` (`oklch(0.60 0.14 45)`) as its single hero
on a cream `#FBF8F0` canvas. See
`LITFIN/src/app/globals.css:32` (`--primary`) and
`LITFIN/src/core/design-system/tokens.ts:13-74`. **Borjie does not
import these values** — we kept LitFin's structure (one-hero-color
ramp, semantic-tinted backgrounds, hairline borders) but swapped the
palette to navy + gold.

### When to use which

- **Hero gold** is reserved for *one* purpose per surface: the primary
  CTA, the active-nav-pill indicator, the focus ring, or the section
  kicker. Never two on the same surface unless one is a state
  (focus-ring on hovered CTA = fine).
- **Cream / off-white** copy reads as Borjie identity in dark mode.
  Do not switch to pure white (`#FFFFFF`) — it reads sterile.
- **Hairline border** (`hsl(var(--border))`) is the default — never
  `border-2` on cards.
- **Tinted semantic backgrounds**: `bg-success/10` + `text-success` +
  `ring-success/20` (mirrors LitFin `.badge-success` at
  `LITFIN/src/app/globals.css:432-439`). Borjie applies the same shape
  via `Badge` variants in `packages/design-system/src/components/Badge.tsx`.

---

## 2. Typography

LitFin parity locked in `packages/design-system/src/styles/globals.css:135-148`.

| Style | Font | Size | Line | Weight | Tracking | Use |
|-------|------|------|------|--------|----------|-----|
| `display` (hero) | Syne | 40-56px | 1.05 | 500 (medium) | `-0.02em` | Page H1, hero copy. Use `.font-display` |
| Display 32 | Syne | 32px (sm 28) | 1.1 | 500 | `-0.02em` | Section H2 |
| Display 24 | Syne | 24px | 1.15 | 500 | `-0.015em` | Card title, panel heading |
| Body lg | Inter | 18px | 1.6 | 400 | normal | Lead paragraph, marketing sub |
| Body | Inter | 16px | 1.5 | 400 | normal | Default body |
| Body sm | Inter | 14px | 1.5 | 400 | normal | Form labels, table cells |
| Caption | Inter | 12px | 1.45 | 500 | `0.04em` | Meta, kicker, footnote |
| Pill kicker | Inter | 11px | 1.3 | 600 (semibold) | `0.18em` uppercase | Section kicker, eyebrow above heading |
| Code | JetBrains Mono | 13-14px | 1.5 | 400 | tabular `tnum lnum` | Numerics in tables, IDs, codes |
| Mono uppercase chip | JetBrains Mono | 10-11px | 1.2 | 600 | `0.22em` uppercase | Trust microcopy under forms, workspace bar kicker |

Body smoothing/feature-settings:
```css
html { -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
body { font-feature-settings: 'cv11','ss01'; text-wrap: pretty; }
.font-display { font-feature-settings: 'ss01' 1,'ss02' 1; font-optical-sizing: auto; text-wrap: balance; }
```
(`packages/design-system/src/styles/globals.css:257-290`). LitFin's
equivalent at `LITFIN/src/app/globals.css:175-187`.

**Rule: paragraph copy uses `text-wrap: pretty`; display headings use
`text-wrap: balance`.** Already wired globally.

---

## 3. Spacing

LitFin uses an **8px grid** (`tokens.ts:124-139`); Borjie uses the
same scale via Tailwind defaults (4-8-12-16-24-32-48-64-96).

### Rhythm rules

- **Marketing section vertical**: `py-20 lg:py-28` (section-to-section
  spacing). See `apps/marketing/src/app/buyers/sign-in/page.tsx:45`.
- **Card inner padding**: `p-6` default, `p-8 sm:p-10` for auth cards
  / generous editorial frames.
- **Auth card outer**: `max-w-md` for sign-in, `max-w-xl` for buyers
  sign-in (single form), `max-w-2xl/3xl` for signup wizards.
- **Form field gap**: `space-y-6` between labelled fields, `space-y-2`
  inside a single field (label → input → helper).
- **Card gap inside a grid**: `gap-4` for compact, `gap-6` for default,
  `gap-8` for marketing tiles.
- **Modal vs Drawer**:
  - Modal max-width: `max-w-md` (confirm), `max-w-lg` (form), `max-w-2xl` (detail)
  - Drawer width (right): `w-96` (sm), `w-[28rem]` (md), `w-[36rem]` (lg)

---

## 4. Card variants

LitFin has six card flavours (`LITFIN/src/app/globals.css:219-340`):

| LitFin class | Where | Borjie equivalent |
|--------------|-------|-------------------|
| `.card-premium` | Default elevated card | `<Card>` default (`packages/design-system/src/components/Card.tsx`) |
| `.card-glass` | Hero overlays, sticky chrome | `glass-card` utility (Borjie inherits in shell) |
| `.card-gradient` | Empty-state hint, "did you know" | `card-gradient` (add as utility) |
| `.card-glow` | Premium pricing tier | `glow-signal` + Card |
| `.spotify-card` | List rows with hover lift | `Card variant="ghost"` + `hover-lift` |
| `.marketing-tile` | Cover-art-style marketing tiles | `marketing-card-elevated` (`globals.css:1271-1283`) |

**Card anatomy** (`<Card>`):
```tsx
<Card>           // hairline border + bg-card + rounded-2xl
  <CardHeader>   // p-6 pb-2, flex-col gap-1.5
    <CardTitle>  // font-display text-lg font-medium
    <CardDescription>  // text-sm text-muted-foreground
  <CardContent>  // p-6 pt-0
  <CardFooter>   // p-6 pt-0 flex justify-between
</Card>
```

Hover behaviour: cards never scale; they elevate (`box-shadow` step
up) and the border shifts from `--border` to `--border-strong`. Match
the rule at `LITFIN/src/app/globals.css:336` (`.marketing-tile:hover`
adds `-translate-y-1` + `border-primary/30 + shadow-lg`).

---

## 5. Button variants

Borjie `Button` in `packages/design-system/src/components/Button.tsx`
already mirrors LitFin's variant list. Specific mappings:

| LitFin variant | Visual | Borjie variant |
|----------------|--------|-----------------|
| `default` | Solid primary, rounded-full | `primary` (rounded-md per Borjie radii) |
| `premium` | Primary + outer glow | `primary` + `glow-signal` utility |
| `gradient` | Animated gradient sweep | (intentionally not ported — too "AI" for Borjie tone) |
| `gold` | Warning→primary gradient | (intentionally not ported) |
| `outline` | Border + bg-transparent | `outline` |
| `secondary` | Muted bg | `secondary` |
| `ghost` | No bg until hover | `ghost` |
| `link` | Underline-on-hover | `link` |
| `destructive` | Solid red | `destructive` / `danger` |
| `success` | Solid emerald | `success` |

**Sizes**: `default` `h-10 px-4`, `sm` `h-9 px-3 text-xs`, `lg` `h-11
px-8 text-base`, `xl` `h-12 px-10`, `icon` `h-10 w-10`. Borjie
extends with `icon-sm` `h-8 w-8` and `icon-lg` `h-12 w-12`.

**Hover/active**: LitFin uses `hover:bg-primary/85` + `active:scale-[0.98]`
across all primary buttons. Borjie buttons use `hover:bg-primary/90`
(slightly less drop) — keep, it reads more institutional.

**Loading**: `loading` prop swaps content for a centered spinner +
"Loading..." text. The `aria-busy` and `aria-disabled` already wired
in Borjie. LitFin uses `<Loader2 className="h-4 w-4 animate-spin" />`
inline — equivalent.

---

## 6. Form fields

LitFin's idiomatic input (sign-in page):
```tsx
const inputClass =
  "w-full pl-11 pr-4 py-3 bg-muted/30 border border-border rounded-xl text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-sm";
```
(`LITFIN/src/app/auth/login/page.tsx:64-69`)

Key idioms:
- **rounded-xl** (12px) — not Borjie's `rounded-md` (6px). For auth
  fields specifically, we adopt `rounded-xl`; for table-inline fields
  we keep `rounded-md`.
- **bg-muted/30** — tinted, never pure white in dark mode.
- **icon-prefix slot at `left-3.5`** — icons live inside the field at
  `top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground`.
- **Eye toggle** for password (`<Eye>` / `<EyeOff>` `right-3.5`).
- **Focus ring**: `ring-2 ring-primary/20` + `border-primary`. Borjie
  swaps `primary` for `signal-500`.

States:
- Idle: `border-border bg-muted/30`
- Hover: `hover:border-border-strong` (only when not focused)
- Focus: `border-primary ring-2 ring-primary/20`
- Error: `border-destructive ring-2 ring-destructive/20`
- Disabled: `opacity-50 cursor-not-allowed`

**Borjie wraps**: `<Input>` and `<Textarea>` in
`packages/design-system/src/components/Input.tsx`. Both accept
`leftIcon` / `rightIcon` props.

### Search bar

Pattern: input + magnifier icon left + optional `Cmd K` kbd hint right.
Borjie ships a dedicated `SearchInput` primitive (added in this sweep,
`packages/design-system/src/components/SearchInput.tsx`).

### Date picker

We adopt `react-day-picker` styled to LitFin shape: cells `h-9 w-9
rounded-lg`, active = `bg-signal-500 text-primary-foreground`, today =
ring, range = `bg-signal-500/20`. Wrapper component at
`packages/design-system/src/components/form/DatePicker.tsx` (not yet
extracted — flagged below).

---

## 7. Status pills

LitFin badge variants (`globals.css:432-467`):
- `badge-success` — emerald 500/10 bg, 600 text, 500/20 ring
- `badge-warning` — amber 500/10 bg, 600 text, 500/20 ring
- `badge-error` — red 500/10 bg, 600 text, 500/20 ring
- `badge-info` — primary 10/10 bg, primary text, primary/20 ring
- `badge-neutral` — muted bg, muted-foreground text, border ring

Borjie `Badge` already does this — but **always** ringed
(`ring-1 ring-inset`), pill shape (`rounded-full`), `text-xs
font-semibold`. Variant mapping:

| Status | Use when |
|--------|----------|
| `success` | Operational, paid, verified, signed-off |
| `warning` | Pending, in-review, expires-soon |
| `error` | Failed, expired, suspended, blocked |
| `info` | Draft, in-progress, queued |
| `neutral` | Archived, default, "no value" |

For tier badges (Tier 1-4 in Borjie ownership matrix) use Badge
`variant="outline"` with the gold ring at `tier === 1`.

---

## 8. Modals + Drawers + Tooltips + Toasts

### Modal

Borjie `Modal` (`packages/design-system/src/components/Modal.tsx`) and
Radix-based `Dialog` (`Dialog.tsx`). Both render centered, max-width
`lg` by default, with a slate/black overlay at `bg-black/80`, plus a
`zoom-in-95 + slide-in-from-top-[48%]` entrance (200ms ease-out).

**LitFin parity**: at `LITFIN/src/components/ui/dialog.tsx` (same
Radix pattern). Borjie matches.

Use `Modal` (custom wrapper) for confirmation flows that need a footer
slot. Use `Dialog` (Radix-direct) when composing form steps inside.

### Drawer (NEW)

Borjie ships a new `Drawer` primitive (`packages/design-system/src/components/Drawer.tsx`)
via Radix Dialog with `side="right"` slide animation. Widths: `sm`
24rem, `md` 28rem (default), `lg` 36rem. Used for entity detail
panels (tenant detail, licence detail, employee detail, parcel
detail). Header is sticky with hairline border-bottom.

### Tooltip

Borjie `Tooltip` (Radix) at `packages/design-system/src/components/Tooltip.tsx`.
Max-width 280px (LitFin parity `tokens.ts:268-273`). `sideOffset=4`,
`zoom-in-95` entrance, `text-sm`, lives at `z-50`.

### Toast

Borjie `Toast` viewport at top on mobile, bottom-right on desktop:
`fixed top-0 ... sm:bottom-0 sm:right-0 md:max-w-[420px]`. Variants:
default / success / warning / info / destructive. Use solid color for
default+destructive only; rest are **tinted** (success →
`bg-success/10 text-success border-success/20`) — polishing pass in
this sweep.

**Placement rule:** confirmation = modal; one-shot acknowledgement =
toast; persistent context = inline alert; floating help = tooltip;
inspection of a single entity = drawer.

---

## 9. Empty states

Pattern (`packages/design-system/src/components/Empty.tsx`):
- Centered column, `py-12`
- 64px circular icon container (`h-16 w-16 rounded-full bg-muted`)
- Lucide icon at `h-8 w-8 text-muted-foreground`
- Title `text-sm font-semibold text-foreground`
- Description `text-sm text-muted-foreground max-w-sm`
- Optional CTA button below

**Copy register**: warm, never accusatory. "No mining sites yet — add
the first to begin." Not "You have no sites." Bilingual sw/en hint
when relevant.

LitFin uses the same shape — `LITFIN/src/components/ui/empty.tsx` (if
present) and inline in `LITFIN/src/app/auth/forgot-password/page.tsx:81-94`
for the post-submit success state.

---

## 10. Loading states

| State | When | Borjie primitive |
|-------|------|------------------|
| Skeleton | Page or list initial load | `Skeleton`, `SkeletonText`, `SectionSkeleton` |
| Spinner | Inline button / icon-button busy | `Spinner` or `Loader2` |
| Progress bar (determinate) | Upload / multi-step task with known %  | `Progress` |
| Progress bar (indeterminate) | Long task with unknown % | `Progress` `indeterminate` |
| Shimmer overlay | Content known to exist, polishing in | `.animate-shimmer` utility |

Skeleton rule: **match the silhouette**, not a generic grey block.
Use `Skeleton` variants that mirror the final layout (avatar, line,
card, table-row).

---

## 11. Navigation

### Top nav

Marketing: `Nav` at `apps/marketing/src/components/Nav.tsx`. Sticky,
hairline `border-b border-border/50`, `backdrop-blur-xl`. Logo
left, primary links centre/right, sign-in CTA right.

Portal: `OwnerTopBar` / admin equivalent — sticky 56px, hairline
border, with breadcrumb left and user avatar right.

### Side nav

`OwnerSidebar`, admin nav. LitFin idiom (`globals.css:499-630`):
- Section labels: `text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50` + dashed line
- Nav items: `rounded-xl px-3 py-2.5 text-sm font-medium`
- Active state: tinted bg + 3px-wide signal-500 pill at left
- Icons: 32px square icon-glass container at `bg-muted/50`

### Breadcrumbs (NEW primitive)

Borjie ships `Breadcrumb` at `packages/design-system/src/components/Breadcrumb.tsx`:
small text, slash-separator, last item in foreground bold,
prior items muted with hover-to-foreground. Lives in sticky top-bar
left.

### Tabs

`Tabs` already in design-system. Use `pill` underlay for primary
nav (`bg-muted/50 rounded-xl p-1` with active = `bg-primary
text-primary-foreground shadow-md shadow-primary/20`), mirroring
LitFin login-page mode tabs at lines 390-424.

### Pagination

`Pagination` already in design-system. Two compact buttons + page
indicator in centre. Mirror LitFin idiom.

---

## 12. Chat UI

Borjie chat panels in `packages/chat-ui/src/borjie/`. Bubble shape:

- User: right-aligned, `rounded-2xl rounded-tr-md`, `bg-signal-500/10
  text-foreground`, hairline `border-signal-500/20`.
- AI: left-aligned, `rounded-2xl rounded-tl-md`, `bg-card text-foreground`
  with chat-ai-bubble glass effect (`globals.css:866-885`).
- Voice mic: circular `h-12 w-12 rounded-full bg-signal-500
  text-primary-foreground` with breathing pulse when recording.
- Audio waveform: 32 bars, animated, `bg-signal-500/40` resting, full
  on amplitude.
- Quick-reply pills: `rounded-full border-border bg-card/80 px-3 py-1.5
  text-xs hover:border-signal-500/50`.
- Attachment chip: `rounded-lg border-border bg-card/80 px-3 py-2 text-xs`
  with paperclip icon left, x-remove right.
- Thinking dots: 3 × `h-1.5 w-1.5 rounded-full bg-signal-500/60` with
  staggered bounce animation, `LITFIN/src/app/globals.css:996-1005`
  parity.
- Language toggle: small pill-toggle in chrome (Swahili / English),
  default sw.

---

## 13. Microcopy register

**Voice**: warm, professional, never jargon-heavy, never American
corporate.

**Forbidden**:
- Em-dashes (em-dash → use ", " or " — " with hair spaces if truly
  needed; default to comma)
- "Karibu" in English copy (use "Welcome back" or "Hi" instead)
- AI-speak: "Let's dive in", "Unleash", "Revolutionize",
  "Game-changer", "Supercharge"
- "Magic", "Wizard" (use "Setup", "Steps")
- "Streamline", "Optimize" without a measurable verb
- Cute emoji in chrome (icons only via lucide / brand SVGs)

**Encouraged**:
- Time-aware greetings: "Habari ya asubuhi" / "Good morning"
  (matched to local time)
- Direct verbs: "Add", "Open", "Send", "Sign", "Verify"
- Bilingual labels with secondary mono caption: `Email <span class="mono caption">EMAIL</span>` only in dual-language surfaces (sign-in)
- Concrete numbers in trust microcopy: "BRELA · TRA · Tumemadini
  verified" — not "Audited", "Compliant"

---

## 14. Motion

Tokens (`globals.css:150-157`):
```
--ease-out:    cubic-bezier(0.16, 1, 0.3, 1)
--ease-in:     cubic-bezier(0.7, 0, 0.84, 0)
--ease-in-out: cubic-bezier(0.83, 0, 0.17, 1)
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1)
--duration-fast:   150ms
--duration-base:   250ms
--duration-slow:   400ms
--duration-slower: 600ms
```

**Choreography rules**:
- Hover lift: 200ms ease-out, `translateY(-1px)` + shadow step up.
- Modal in: 200ms ease-out, `zoom-in-95` + `fade-in`.
- Drawer in: 250ms ease-out, `slide-in-from-right`.
- Toast in: 300ms ease-out, `slide-in-from-bottom` (desktop) / `slide-in-from-top` (mobile).
- Stagger children: 80ms per item, max 8 children (`.stagger-children`
  in `LITFIN/src/app/globals.css:1150-1162`).
- Reduce-motion: always honour `prefers-reduced-motion: reduce` — already
  wired at `globals.css:321-329`.

Avoid:
- Continuous pulsing (LitFin removed these — `globals.css:1052-1053`).
- Bouncy spring on every interaction — reserve `--ease-spring` for
  toast success ticks and the gold logo-mark wordmark.

---

## 15. Accessibility

- **Focus ring**: 2px solid signal-500 with 2px offset
  (`globals.css:293-297`). Visible on every interactive element.
- **Contrast**: foreground `#F5F5F0` on `#0B0F19` = 13.1:1 (WCAG
  AAA). Muted `#A0A4B0` on `#0B0F19` = 6.5:1 (AA). Gold `#FFC857` on
  `#0B0F19` = 11.2:1 (AAA for large text).
- **Kbd hints**: small `<Kbd>` chip primitive (added in this sweep)
  for keyboard-first surfaces (`Cmd K` search, `Esc` close drawer).
- **Skip link**: `<a href="#main-content">` first focusable element in
  layout; already wired in marketing layout.
- **`aria-busy`** on loading buttons (Borjie Button does this).
- **`aria-live="polite"`** on toast viewport, `assertive` on error
  alerts.
- **Locale switcher** never reloads — server cookie + soft refresh.

---

## Surfaces this DNA applies to (Borjie)

| Surface | LitFin pattern citation |
|---------|-------------------------|
| Marketing landing | `LITFIN/src/app/(marketing)/page.tsx` |
| Audience pages (for-PML, for-SML, for-cooperatives) | `LITFIN/src/app/(marketing)/for-msmes/`, `for-saccos/` |
| Sign-in (owner / admin / buyer) | `LITFIN/src/app/auth/login/page.tsx:64-915` |
| Sign-up wizard | `LITFIN/src/app/auth/signup/page.tsx` |
| Forgot password | `LITFIN/src/app/auth/forgot-password/page.tsx` |
| Reset password | `LITFIN/src/app/auth/reset-password/page.tsx` |
| Verify email | `LITFIN/src/app/auth/verify-email/page.tsx` |
| Portal shell (owner cockpit, admin console) | `LITFIN/src/app/(borrower)/borrower/layout.tsx` |
| Dashboard hero | `.dashboard-hero` in `LITFIN/src/app/globals.css:692-718` |
| Dashboard sections | `.dashboard-section` in `LITFIN/src/app/globals.css:720-742` |
| Sidebar | `.sidebar-nav-*` in `LITFIN/src/app/globals.css:499-630` |
| Side panels / drawers | `LITFIN/src/components/ui/sheet.tsx` |
| Detail pages (tenant, licence) | `LITFIN/src/app/(officer)/officer/applications/[id]/page.tsx` |
| 404 / not-found | `LITFIN/src/app/not-found.tsx` |
| 500 / error boundary | `LITFIN/src/app/error.tsx` |
| Cookie banner | `LITFIN/src/components/CookieConsent.tsx` |
| Privacy / Terms / DPA | `LITFIN/src/app/(marketing)/privacy/page.tsx` |

## Hard rules

1. **Never** introduce LitFin orange `#C46B2C`. Borjie gold only.
2. **Never** import LitFin-only utility classes (`.spotify-card`,
   `.bento-grid` etc.) — reuse Borjie equivalents or extract a new
   utility into `globals.css` under a Borjie-prefixed name.
3. **Never** inline a primitive that exists in design-system. If a
   primitive is missing, **add** it before the use site is shipped.
4. **Always** bilingual sw/en where copy is user-visible. English
   never says `Karibu`.
5. **Always** observe `prefers-reduced-motion`.
6. **Always** add a focus-visible ring on every clickable element.
7. **No em-dashes**. No mock data in production surfaces.

---

## How to verify a surface is "LitFin-grade"

A 30-second self-test before merging a UI change:

1. Does it use the design-system primitive (Card/Button/Input/Badge),
   not inline classes?
2. Is the focus ring visible and gold (`signal-500`)?
3. Is body text `--foreground` (cream), not `text-white` or
   `text-gray-50`?
4. Is the border hairline `--border`, not `border-2`?
5. Does the CTA hover land at `bg-signal-400` (lighter), not
   `bg-signal-600` (darker)?
6. Is the copy bilingual where it should be? No em-dashes?
7. Does Tab → Shift+Tab reach every interactive element?
8. Does `prefers-reduced-motion` kill the animation?

Eight yeses = ship.

