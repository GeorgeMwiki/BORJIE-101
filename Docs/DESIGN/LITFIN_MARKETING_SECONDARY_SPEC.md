# LitFin marketing secondary surfaces — measured spec

This document captures the structural DNA of LitFin's secondary
marketing pages so Borjie can ship pixel-parity siblings. It extends
`LITFIN_MEASURED_SPEC.md` (which covers the home, hero, capabilities,
nav, footer, ecosystem and chat shell) to the eleven secondary
surfaces called out in WAVE-29 / SHARED-PARENT PIXEL PARITY.

The pages covered here:

1.  Audience landings (`for-pml`, `for-ml`, `for-sml`, `for-cooperative`,
    `for-family-office`, `for-investor`, `for-buyer`, `for-off-taker`,
    `for-bank`, `for-regulator`, `for-csr-community`)
2.  Pricing (`/pricing`)
3.  Blog (`/blog` index + `/blog/[slug]` template)
4.  Support hub (`/support`)
5.  Documentation viewer (`/docs`, `/docs/[slug]`)
6.  Security trust page (`/security`)
7.  Legal pages (`/legal/privacy`, `/legal/terms`,
    `/legal/subprocessors`, `/legal/cookies`)
8.  About (`/about`)
9.  Careers (`/careers`)
10. Contact (`/contact`)
11. Error templates (`/404`, `/500`, `/offline`)

Each entry below lists the **DOM order**, the **measurement**
references (in `LITFIN_MEASURED_SPEC.md` lookup form, e.g. `S2/r3`
for "Section 2, row 3"), the **content slots** and the **Borjie
data hook** that owns the copy / i18n key.

The only legal visual diff vs LitFin is the brand swap — see
`LITFIN_MEASURED_SPEC.md` Section 16.

---

## 1. Audience landings (template-driven)

Every audience landing reuses one template, `AudiencePage`. The
template is already in `apps/marketing/src/components/audience/
AudiencePage.tsx` and matches LitFin's `for-banks/page.tsx`
structure section-for-section.

Page DOM (top to bottom):

| Slot                  | Spec ref              | Note                                                                 |
|-----------------------|-----------------------|----------------------------------------------------------------------|
| `Nav`                 | S4 (Marketing nav)    | Sticky, scroll-aware, shared.                                        |
| Hero band             | S5 + S6 (hero)        | Kicker pill (signal-500), bilingual headline, sub, dual CTA, trustline of 3 dots. |
| Stats triplet         | S7 (capabilities/stats) | 3-up grid, `grid grid-cols-1 md:grid-cols-3 gap-5` cards `rounded-2xl border bg-card p-6 md:p-8`. |
| How-it-works          | S8 (how-arc)          | Ordered list, 3 rows, mono-numbered `01 / 02 / 03`, accent in signal-500. |
| Problem-Solution duo  | S9 (problem/solution) | Two-column band: red destructive-tinted bullets / gold check-circle bullets. |
| CTA footer            | S15 (final-cta)       | Centered headline + sub + single `Apply for the pilot` primary CTA. |
| `Footer`              | S17 (footer)          | Shared, 4 columns + bottom-bar wordmark.                            |

Audience set (11 entries):

```
pml, ml, sml, cooperative,
family-office, investor, buyer, off-taker,
bank, regulator, csr-community
```

Each audience consumes one i18n key `audiencePages.{slug}` containing
all 60+ strings (hero copy, stats, steps, problem/solution items, CTA).
Existing keys: `pml, ml, sml, cooperatives`. Missing: 7. Spec the
template once; copy comes from the i18n bundle.

Kicker icon mapping (from `lucide-react`):

```
pml             → Pickaxe
ml              → Mountain
sml             → Gem
cooperative     → Users
family-office   → Landmark
investor        → Coins
buyer           → ShoppingBag
off-taker       → Truck
bank            → Building2
regulator       → ShieldCheck
csr-community   → HeartHandshake
```

---

## 2. Pricing — LitFin parity

LitFin's `/pricing` page (938 lines, ref `LITFIN_PRICING.tsx`) has
four sections:

| #  | Section                              | Spec ref               |
|----|--------------------------------------|------------------------|
| 1  | Hero (centered, single column)       | S5 (compact)           |
| 2  | Pricing cards 4-up (Starter / Pro / Enterprise / Programs) | S7 (4-up card grid) |
| 3  | Trust-badges wordwall                 | S6 (badge strip)        |
| 4  | Feature comparison table (desktop) + stacked cards (mobile) | NEW (S18)             |
| 5  | FAQ accordion                         | NEW (S19)               |
| 6  | Final-CTA band                        | S15                     |

Borjie's current `/pricing` only ships sections 1 and 2 — add 3, 4,
5, 6 to reach parity. Borjie tiers (replace LitFin's labels):

```
Mwanzo (Free) | Mkulima | Mfanyabiashara | Kampuni | Group
```

The comparison table grouping (`COMPARISON_CATEGORIES`):

1.  AI and intelligence
2.  Operations and licences
3.  Treasury and money
4.  Workforce and HSE
5.  Platform and support

---

## 3. Blog — index + post template

Index:

| Slot                | Notes                                                    |
|---------------------|----------------------------------------------------------|
| Nav                 | Shared.                                                  |
| Hero band           | Centered kicker + heading + sub.                        |
| Featured post card  | Large card, hero image left, title + excerpt + meta right. |
| Post grid (3-up)    | `rounded-2xl bg-card border` cards with cover, kicker, title, excerpt, byline. |
| Pagination          | Next/prev with `rounded-xl border` arrow buttons.       |
| Footer              | Shared.                                                  |

Post template:

| Slot                  | Notes                                                  |
|-----------------------|--------------------------------------------------------|
| Nav                   | Shared.                                                |
| Post hero             | Centered, cover image, kicker, title, byline, date, read time. |
| Body type ramp        | `max-w-prose` body, `text-base/relaxed`, h2 `text-3xl`, h3 `text-2xl`, code in `font-mono text-sm`. |
| Share rail            | Sticky left-rail on lg+ with twitter / linkedin / copy-link buttons.        |
| Related posts (3-up)  | Same card primitive as index.                          |
| Final CTA band        | "Subscribe to the brief" or "Apply for the pilot".     |
| Footer                | Shared.                                                |

Borjie's blog will start as a static MDX-free index (zero posts) with
copy slot `blog.kicker / heading / sub / emptyState`. Real posts come
later — the template ships now so editorial can drop MDX content
behind a feature-flag.

---

## 4. Support hub — `/support`

| Slot                 | Notes                                                          |
|----------------------|----------------------------------------------------------------|
| Nav                  | Shared.                                                        |
| Hero                 | Centered, search field (placeholder only), kicker, heading, sub. |
| Quick-link cards 3-up | Help articles · Onboarding · Office hours.                    |
| FAQ accordion        | 4 categories × 4-6 questions each, tab switcher at top.        |
| Contact strip        | Email / phone / WhatsApp icons on a 3-up `rounded-2xl border bg-card` strip. |
| Final-CTA band       | "Schedule office hours."                                       |
| Footer               | Shared.                                                        |

---

## 5. Docs viewer — `/docs/[slug]`

Existing Borjie `/docs` page is a link index. To match LitFin's docs
nav rail + breadcrumb pattern, add a `DocsShell` layout component
under `apps/marketing/src/components/docs/`:

| Slot              | Notes                                                     |
|-------------------|-----------------------------------------------------------|
| Nav               | Shared.                                                   |
| Breadcrumb        | `home / docs / [slug]` mono small + chevrons.             |
| Left rail (nav)   | Sticky, `w-64` on lg+, sections nested.                   |
| Center column     | `max-w-prose` body, same type ramp as blog post.          |
| Right rail (TOC)  | Sticky, h2/h3 anchors with current-section indicator.    |
| Footer            | Shared.                                                   |

---

## 6. Security trust page — `/security`

| Slot                 | Notes                                                         |
|----------------------|---------------------------------------------------------------|
| Nav                  | Shared.                                                       |
| Hero (centered)      | Kicker `Security & Trust`, big claim, sub.                     |
| Pillars 4-up         | Encryption · Access · Audit · Residency. Card `rounded-2xl border bg-card p-8`. |
| Architecture diagram | Static SVG inside `rounded-2xl border` panel.                  |
| Compliance badges    | 5-up wordwall (BoT, NEMC, TZ-PDPA, ISO 27001 ready, SOC 2 ready). |
| Audit trail callout  | 2-column band: left = "Every action on the chain.", right = small live-fabric mock. |
| Final CTA            | "Talk to our security team."                                   |
| Footer               | Shared.                                                       |

---

## 7. Legal pages

All four legal pages share one shell `LegalPage`. Existing privacy
and terms ship this shell already — extend to add the
`subprocessors` and `cookies` routes:

| Slot           | Notes                                                                  |
|----------------|------------------------------------------------------------------------|
| Nav            | Shared.                                                                |
| Page hero      | Centered, kicker, title, `lastUpdated` date mono small.                 |
| Body           | `max-w-prose` two-column on lg+: left rail with anchored section nav, right column with prose. |
| Footer         | Shared.                                                                |

Sub-rows per page:

```
/legal/privacy         → 12 sections (existing)
/legal/terms           → 10 sections (existing)
/legal/subprocessors   → table: vendor / role / region / contract link
/legal/cookies         → table: cookie / purpose / category / lifetime
```

---

## 8. About — narrative

Existing `/about` is text-only. Add LitFin's full narrative layout:

| Slot                | Notes                                                                |
|---------------------|----------------------------------------------------------------------|
| Nav                 | Shared.                                                              |
| Hero (centered)     | Kicker, headline, sub.                                               |
| Origin story        | 2-column band: left text, right large image / illustration.          |
| Values 4-up         | `rounded-2xl border bg-card p-8` cards, icon + title + body.         |
| Statistics strip    | 4 numbers band, mirrors LitFin S7 stats triplet but 4-up.            |
| Timeline            | Vertical timeline, dot + year + title + body rows.                   |
| Team carousel       | Horizontal-scroll faces with name + role chip.                       |
| Final CTA band      | "Join us" + dual CTA.                                                |
| Footer              | Shared.                                                              |

---

## 9. Careers — narrative + roles

| Slot                | Notes                                                          |
|---------------------|----------------------------------------------------------------|
| Nav                 | Shared.                                                        |
| Hero                | Kicker / headline / sub + apply CTA.                            |
| Values 4-up         | Same card primitive as about.                                   |
| Open-roles list     | Vertical list of role cards: title + dept + location + apply link. |
| Benefits band       | 6-up grid of icon + label chips.                                |
| Final CTA           | "Apply now."                                                    |
| Footer              | Shared.                                                        |

---

## 10. Contact — form + alternates

| Slot                | Notes                                                          |
|---------------------|----------------------------------------------------------------|
| Nav                 | Shared.                                                        |
| Hero (centered)     | Kicker / heading / sub.                                         |
| 2-column band       | Left: contact form (name, email, org, type select, message, submit). Right: alternate channels (email / phone / office address) + map placeholder. |
| Inquiry-type chips  | 5 chips above the form: demo · partnership · support · general · press. |
| Final CTA           | "Or schedule a 15-minute call."                                 |
| Footer              | Shared.                                                        |

---

## 11. Error templates

Already shipped:

```
/not-found.tsx     → 404
/error.tsx         → 500 (caught in client tree)
/global-error.tsx  → 500 root-level
```

Add `/offline/page.tsx`:

| Slot              | Notes                                                          |
|-------------------|----------------------------------------------------------------|
| Hero (centered)   | `WifiOff` icon tile, kicker `Offline`, headline, sub.            |
| CTA               | `Reload` button (calls `window.location.reload()`).             |

Verify the existing 404 / 500 against LitFin's matching pages:

-   Tinted icon container in a `rounded-2xl border bg-card` `16 × 16 wh` tile.
-   Kicker mono uppercase `text-[11px] tracking-[0.22em]`.
-   Heading `font-display text-4xl sm:text-5xl`.
-   Body `text-sm leading-relaxed text-muted-foreground`.
-   Primary CTA `bg-signal-500 rounded-xl`.
-   Secondary CTA `border bg-card rounded-xl`.

---

## 12. Shared design-system primitives

Every surface in this spec lives downstream of `@borjie/design-system`.
The "father" pattern means a single Card, Button, Badge, Modal, Toast,
EmptyState, Drawer, FormField, ChatBubble — never inlined. Where a
primitive does not yet exist in the package, see
`packages/design-system/src/components/` for the category-rooted
location to add it.

The following category folders must exist in `packages/design-system/
src/components/`:

```
surface/   Card · Section · Divider
action/    Button · IconButton · ChipButton
feedback/  Badge · Pill · Toast · Banner · Alert
overlay/   Modal · Drawer · Popover · Tooltip · BottomSheet
form/      Input · Textarea · Select · Combobox · DatePicker · FileUpload · SearchInput · FormField
data/      Table · Tabs · Accordion · Breadcrumb · Pagination
navigation/ Sidebar · TopBar · Nav · Crumb
chat/      Bubble · ThinkingDots · Composer · ChipRow
pageframe/ PageHero · MetricStrip · EmptyState · LoadingShimmer · ErrorBoundary · OfflineState
media/     Avatar · AvatarRing · Logo · Wordmark · BrandMark
```

Each new primitive must be exported from `packages/design-system/src/
index.ts` and accept the same prop shape across web and native (when
native exists).

---

## 13. Bilingual / time-aware copy

Every surface uses the central `useLocaleMessages(locale)` helper, the
`getMessages(locale)` server helper, and the `formatCurrency(amount,
code)` formatter. Greetings are time-aware via `useTimeAwareGreeting`:

```
00:00–11:59  → "Good morning"     · "Habari za asubuhi"
12:00–17:59  → "Good afternoon"   · "Habari za mchana"
18:00–22:59  → "Good evening"     · "Habari za jioni"
23:00–23:59  → "Good evening"     · "Habari za jioni"
```

`useTimeAwareGreeting` returns a stable string for SSR — for client-
side per-second freshness the consumer uses `useTimeAwareGreetingLive`.

Default locale is **English**. Swahili is opt-in via the
`borjie_locale` cookie. EN never uses "Karibu" as a greeting.

---

## 14. Implementation plan

Order of delivery (per atomic commit):

1.  Spec doc (this file). ←  done
2.  Audience pages — add 7 missing landings + i18n.
3.  Pricing — add comparison table + FAQ + final CTA sections.
4.  Blog index + post template.
5.  Support hub.
6.  Docs viewer shell.
7.  Security page.
8.  Legal sub-pages (subprocessors, cookies) + audit privacy/terms.
9.  About v2 + Careers v2 + Contact (new).
10. Offline page + verify 404 / 500.
11. Design-system primitive additions (per category).
12. App refactors removing inline components.

---

## 15. Acceptance gates

A page passes when:

-   It mounts the shared `Nav` and `Footer`.
-   All copy reads from `getMessages(locale)`, no inline literals.
-   Every `<Card>`, `<Button>`, `<Badge>`, `<Modal>`, `<Toast>`,
    `<Drawer>`, `<EmptyState>` is sourced from `@borjie/design-system`.
-   No inline Tailwind that re-implements an existing primitive.
-   `pnpm --filter @borjie/marketing typecheck` returns 0.
-   `curl -sS http://localhost:3030/<path>` returns 200 with the right
    LitFin-spec elements in the HTML body (kicker, headline, CTAs).
