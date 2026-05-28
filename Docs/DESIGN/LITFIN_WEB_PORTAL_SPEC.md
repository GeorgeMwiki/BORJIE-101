# LitFin Web Portal — Measured Spec (for Borjie pixel parity)

Last updated: 2026-05-28
Audience: Borjie design-system + owner-web + admin-web maintainers.

This file is the measured pixel-spec extracted from LitFin's two
authenticated web portals (`(borrower)` and `(officer)` / `(admin)`
groups) and from the shared `PortalSidebar` shell. The numbers below
are class-string-exact so that fresh Borjie code can be authored
against the same outcome without copying LitFin source.

Borjie token substitutions are noted in line. The two universal
mappings are:

  - `primary` (LitFin amber `#F59E0B`) becomes Borjie `signal-500`
    `#FFC857`. Every amber / `text-primary` / `bg-primary` token in
    LitFin re-targets to `signal-500` in Borjie.
  - `bg-card` / `bg-background` keep their names; Borjie's tailwind
    theme already maps them to the navy-on-cream palette.

## 1. Portal shell

### 1.1 Outer layout

LitFin (`(borrower)/layout.tsx`):

```
<div className="portal-shell"> <!-- = flex h-screen overflow-hidden -->
  <Sidebar />                  <!-- shrink-0, h-screen -->
  <main className="flex-1 ..." >...</main>
</div>
```

Borjie (`OwnerShell.tsx` + `AdminShell.tsx`):

```
<div className="relative flex min-h-screen bg-background">
  <Sidebar />
  <div className="flex flex-1 flex-col overflow-hidden">
    <TopBar />
    <main className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-7xl px-6 py-8 lg:px-8">
        {children}
      </div>
    </main>
  </div>
</div>
```

Owner-web uses `max-w-7xl`; admin-web uses `max-w-screen-2xl px-6
lg:px-10 py-8` to mirror LitFin's wider officer console real estate.

### 1.2 Sidebar measurements

Source: `PortalSidebar.tsx`.

| Slot                       | Spec class                                              |
|----------------------------|---------------------------------------------------------|
| Outer width — expanded     | `md:w-[312px]`                                          |
| Outer width — collapsed    | `md:w-[88px]`                                           |
| Outer width — mobile drawer | `w-[86vw] max-w-[320px] md:max-w-none`                  |
| Outer chrome               | `bg-gradient-to-b from-white via-white to-slate-50/80 dark:from-background dark:via-background dark:to-card` |
| Right border               | `border-r border-border/30 dark:border-white/5`         |
| Position                   | `fixed inset-y-0 left-0 md:relative`                    |
| Header height              | `h-[72px]`                                              |
| Header inner padding       | `px-5` (or `px-3` when collapsed)                       |
| Header bottom border       | `border-b border-border/30 dark:border-white/5`         |
| Search padding             | `px-3 pt-3 pb-1`                                        |
| Body padding               | `py-4` + `px-2` collapsed or `px-3` expanded            |
| Footer padding             | `p-4 space-y-3` (or `p-2 space-y-2` collapsed)          |
| Section divider            | dashed `border-t border-dashed border-border/60`        |
| Section label              | `text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500` |
| Section label gap          | `gap-3` between label + line                            |
| Group trigger              | flex row + `chevron-down rotate-180 when expanded` (`transition-transform duration-200`) |
| Group panel padding        | `py-1.5` between rows                                   |
| Nav item row gap           | `gap-3`                                                 |
| Nav item padding           | `px-3 py-2`                                             |
| Nav item radius            | `rounded-xl`                                            |
| Nav item label             | `text-sm font-medium`                                   |
| Icon-glass tile            | `h-9 w-9 rounded-lg` with `bg-muted/40` (Borjie: `bg-surface/60`) |
| Active row                 | adds `bg-primary/5` (Borjie: `bg-signal-500/10`) +     |
|                            | left pill `absolute left-0 h-5 w-[3px] -translate-y-1/2 bg-primary` (Borjie: `bg-signal-500`) |
| Active icon tile           | `bg-primary/15 text-primary` (Borjie: `bg-signal-500/15 text-signal-500`) |
| Hover                      | `hover:bg-muted/40 hover:text-foreground`               |
| Indicator transition       | framer-motion `{ width: 0 → 3, opacity: 0 → 1 }` over   |
|                            | `duration: 0.2`                                         |

The Borjie sidebar (`apps/owner-web/src/components/owner-shell/Sidebar.tsx`)
applies this rule set with `w-[260px]` (Borjie chose a slightly tighter
width — the LitFin `312px` is matched on admin-web only because the
admin console has eight permanent sections; owner-web condenses to 260
without crowding because each section has fewer rows). Both shells run
through `flex h-screen` + `sticky top-0`.

### 1.3 Top bar measurements

| Slot                       | Spec                                                                              |
|----------------------------|-----------------------------------------------------------------------------------|
| Height                     | `h-14` (56 px). LitFin officer + admin uses `h-16`; Borjie admin-web matches `h-16`. |
| Position                   | `sticky top-0 z-30`                                                               |
| Background                 | `bg-background/85 backdrop-blur-xl`                                               |
| Bottom border              | `border-b border-border/60`                                                       |
| Padding                    | `px-6`                                                                            |
| Breadcrumb chevron         | `ChevronRight` size `h-3.5 w-3.5 text-neutral-500`                                |
| Current crumb              | `text-sm font-semibold text-foreground`                                           |
| Trail crumb                | `text-sm text-neutral-400 hover:text-foreground`                                  |
| Ask CTA                    | `inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold bg-signal-500 text-background` |
| Notifications bell         | `rounded-xl p-2 text-neutral-400 hover:bg-surface`                                |
| Notifications dot          | `absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-signal-500`               |
| Persona name row           | `text-xs font-semibold text-foreground` over `text-[10px] text-neutral-500`       |
| Persona avatar             | `h-8 w-8 rounded-full bg-gradient-to-br from-signal-500 to-signal-700`            |
| Persona separator          | `h-6 w-px bg-border/60`                                                           |

## 2. Dashboard composition

LitFin borrower dashboard order:
  0. Brain inbox banner (slot, set by layout).
  1. Greeting hero — eyebrow + `font-display text-4xl sm:text-5xl` title + subline + 3 CTA pills.
  2. Today's brief — 3-tile metric strip (`lg:grid-cols-3`, `gap-4`).
  3. Today's actions — 2-col card grid (`md:grid-cols-2`).
  4. This week — 3-col card grid (`md:grid-cols-3`).
  5. Brain stream — `<Card variant="outline">` panel with 3 rows.
  6. Live BFF surface.

Eyebrow class: `font-mono text-[11px] uppercase tracking-[0.18em] text-signal-500`.
Section header class: `text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400`.

Metric tile: `Card` with `CardContent className="flex items-start justify-between p-6"`. Value class:
`font-display text-3xl text-foreground`. Sub: `text-xs text-neutral-400`.
Icon tile: `rounded-xl bg-signal-500/10 p-2.5 text-signal-500`.

Action card: `Card hoverable`, body padding `p-6`. CTA:
`inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-surface`.

Event card: relative block with left tone ring
`before:absolute before:left-0 before:top-0 before:h-full before:w-[3px]` and
`tone === 'signal' ? before:bg-signal-500 : tone === 'warning' ? before:bg-warning : before:bg-neutral-500`.

Brain stream row: `flex items-start gap-3` with `mt-1.5 h-2 w-2 rounded-full` dot. Dot tone map: signal→`bg-signal-500`, warning→`bg-warning`, success→`bg-success`.

## 3. Detail routes

LitFin pattern:

```
<header sticky top-0 border-b border-border/30 bg-background/85 backdrop-blur-xl>
  <Breadcrumb /> + filter bar (chips + search + sort)
</header>
<list> ... row click opens Drawer side="right" w-[480px]
```

Borjie equivalents — owner-web uses `<PageHero slug=… actions=… meta=…/>` from
`apps/owner-web/src/components/shared/PageHero.tsx`. The PageHero:
  - Eyebrow `font-mono text-[10px] uppercase tracking-[0.18em] text-signal-500`
  - Display title `font-display text-3xl sm:text-4xl tracking-tight`
  - Sw italic gloss `text-sm italic text-neutral-500`
  - Intent line `text-sm leading-relaxed text-neutral-300`
  - Actions cluster `flex flex-wrap items-center gap-2` right-aligned on desktop.

## 4. Modals

Source: LitFin `Dialog` (Radix wrapper) + spawn confirmation in PortalSidebar.

| Slot                 | Spec                                                  |
|----------------------|-------------------------------------------------------|
| Overlay              | `bg-black/40 backdrop-blur-sm`                        |
| Inner width          | `w-full max-w-sm` (compact) or `max-w-2xl` (form)     |
| Inner padding        | `p-6` (compact) or `p-7` (form)                       |
| Border + radius      | `rounded-2xl border border-border/50 bg-card shadow-2xl` |
| Mount transition     | framer `{ scale: 0.95 → 1, opacity: 0 → 1, y: 8 → 0 }` with `type: spring, damping: 25, stiffness: 300` |
| Header               | flex row, gap-3, icon tile `h-10 w-10 rounded-xl bg-primary/10` → Borjie `bg-signal-500/10` |
| Title                | `text-sm font-semibold text-foreground`               |
| Body                 | `text-sm leading-relaxed text-muted-foreground`       |
| Footer cluster       | `flex gap-2` with primary right-most, secondary left  |

Borjie uses `@borjie/design-system/Dialog` + `@borjie/design-system/Modal` —
both already match these measurements.

## 5. Drawers

LitFin: `@litfin/ui` Drawer wraps Radix. Right-side default.

| Variant             | Width                |
|---------------------|----------------------|
| `right` (default)   | `w-[480px] sm:w-[520px]` |
| `right` wide        | `w-[640px]`              |
| `left`              | `w-[400px]`              |
| `bottom`            | `h-[60vh] max-h-[680px]` |

Outer chrome: `bg-card border border-border/60 shadow-2xl`.
Sticky header: `sticky top-0 px-6 py-4 border-b border-border/60 bg-card/95 backdrop-blur-xl`.
Body: `px-6 py-5 overflow-y-auto`. Sticky footer: `sticky bottom-0 px-6 py-4 border-t border-border/60 bg-card/95`.

Borjie equivalent: `@borjie/design-system/Drawer` matches all of this verbatim.

## 6. Toasts

LitFin: `Toaster` component centred top.
Variants:
  - `success` — `border-l-4 border-success bg-card text-success`
  - `warning` — `border-l-4 border-warning bg-card text-warning`
  - `critical` — `border-l-4 border-destructive bg-card text-destructive`
  - `info`    — `border-l-4 border-signal-500 bg-card text-signal-500`

Border-left rail: `w-1`. Inner padding: `p-4`. Title:
`text-sm font-semibold`. Body: `text-xs text-neutral-400`.

Borjie equivalent: `@borjie/design-system/Toast` already ships these variants.

## 7. Empty states

LitFin `EmptyState`: centred column, tinted icon container
`h-12 w-12 rounded-2xl bg-muted/40` (Borjie: `bg-signal-500/10`),
display title `text-base font-semibold text-foreground`, description
`text-sm text-muted-foreground max-w-md`, action `inline-flex … bg-primary`.

Borjie: `@borjie/design-system/Empty` + `apps/owner-web/src/components/shared/EmptyState.tsx`
implement this measurement exactly.

## 8. Loading skeletons

LitFin per-surface skeletons:
  - Page-shell skeleton — `p-6 animate-pulse space-y-4` with three rounded grey bars + a 64-row chart placeholder.
  - Card skeleton — `h-44 animate-pulse rounded-lg border border-border bg-surface/40`.
  - Strip skeleton — `grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4` × 4 cards.

Borjie matches in `DashboardMetricStrip.tsx`, `AdminDashboardSurface.tsx`,
`OwnerDashboardSurface.tsx`. The 28-px and 44-px placeholder heights are
preserved.

## 9. Forms

Input shape: `Input` primitive — `h-10 rounded-lg border border-border bg-surface px-3 text-sm text-foreground placeholder:text-neutral-500 focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:outline-none`.

Select shape: same `h-10 rounded-lg` chrome with chevron right-aligned.

Label: `text-xs font-medium text-neutral-300 uppercase tracking-wide`.
Help: `text-[11px] text-neutral-500`.
Error: `text-[11px] text-destructive`.

Focus ring tokens map: LitFin amber `ring-primary/30` → Borjie `ring-signal-500/30`.

## 10. Tab strip (Owner OS)

LitFin officer console "context tabs" — pill-shape, dashed dotted underline
when context is dirty. Borjie OwnerOSShell already implements this with
`flex items-center gap-1.5 overflow-x-auto border-b border-border bg-surface/50 px-3 py-2`
and the `bg-warning/10 text-warning` active state for the cockpit's
"working ticket" feel.

## 11. Animation tokens

Spring (modals + drawers): `type: 'spring', damping: 25, stiffness: 300`.
Tween (nav, indicators): `duration: 0.2, ease: [0.22, 1, 0.36, 1]`.
Sidebar collapse: `transition-all duration-500 ease-out`.
Hover: `transition-colors duration-200`.

## 12. Color substitutions

| LitFin token        | Borjie token                | Hex / OKLCH                                   |
|---------------------|-----------------------------|-----------------------------------------------|
| `primary`           | `signal-500`                | `#FFC857`                                     |
| `primary/10`        | `signal-500/10`             | `#FFC857` @ 10%                               |
| `primary-foreground`| `background` (navy)         | `#17100A`                                     |
| `background`        | `background`                | unchanged                                     |
| `foreground`        | `foreground`                | unchanged                                     |
| `card`              | `surface`                   | unchanged                                     |
| `border`            | `border`                    | unchanged                                     |
| `muted`             | `surface/60`                | unchanged                                     |
| `destructive`       | `destructive`               | unchanged                                     |
| `warning`           | `warning`                   | unchanged                                     |
| `success`           | `success`                   | unchanged                                     |

## 13. Mining estate copy register

All page copy must read mining-estate-first, not single-pit. The
existing screens registry (`apps/owner-web/src/lib/screens.ts`) is the
canonical source of titles, intents, and Swahili glosses. Estate
sub-domains (Subsidiaries, Holdings, Family Office, Succession,
Ancillary, Asset Register) live under `/estate/*` and are already
mapped through the renderer registry. The greeting hero on `/dashboard`
shows the full legal name + region + site count + plan in the subline
so the operator always sees the full estate frame, never one site in
isolation.

## 14. Bilingual register

Default language is Swahili (`sw`). The shell pushes the language
preference into the page render context; every primitive accepts an
`isSw` flag or pulls `useTranslation()`. EN never uses "Karibu"; the
greeting is "Welcome back, {salutation}". Sw greeting is
"Habari ya {timeOfDay}, {salutation}". Both are time-aware in
`@/lib/owner/greeting.ts`.

## 15. Implementation status (Borjie)

  - Shell — owner + admin both use `@borjie/design-system` primitives,
    apply every measurement above.
  - Sidebar — both portals follow the LitFin pattern. Owner sidebar
    width is `260px` (intentional tighter variant; `312px` is the
    LitFin maximum and is reserved for admin where eight permanent
    sections need the breathing room).
  - Top bar — owner is `h-14`, admin is `h-16`.
  - Dashboard — owner-web dashboard composition follows sections 0-6
    of section 2. Admin dashboard mirrors LitFin officer.
  - Detail routes — every (routes)/* page uses `PageHero` + an
    appropriate body (list / card grid / cockpit).
  - Modals + Drawers — `@borjie/design-system/Modal`,
    `@borjie/design-system/Drawer`, `@borjie/design-system/Dialog`.
  - Toasts — `@borjie/design-system/Toast` + `useToast`.
  - Empty + skeletons — both packages ship the measurements above.
  - Forms — `@borjie/design-system/Input` + `Select` + `Label`.
  - Tabs — `@borjie/design-system/Tabs` and `OwnerOSShell` tab strip.
