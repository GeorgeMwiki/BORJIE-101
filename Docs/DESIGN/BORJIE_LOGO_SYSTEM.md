# Borjie Logo System

Last updated: 2026-05-28
Authoring craft tier: LitFin-parity (Jony Ive / Paula Scher / Rauno Freiberg).
Same hand, different vertical: Borjie sits next to LitFin as a sibling identity, tuned for mining-estate scale.

## 1. Motif rationale

We chose Option D — letter mark "B" with mining-strata bowls.

Why this won over the alternatives:

| Option | Verdict | Reason |
|---|---|---|
| A. Geometric mountain-with-spark | Rejected | Reads as outdoor / climbing brand, not estate-scale gravity. |
| B. Concentric ore-ring | Rejected | Too close to the previous gold-orb placeholder; insufficient differentiation. |
| C. Cut-stone diamond | Rejected | Reads as luxury jewellery / commodity ETF, not operating system. |
| **D. Letter B with mining-strata bowls** | **Chosen** | Strongest brand differentiator. The two bowls of the B are formed by stacked geological strata bands. Reads as a B at first glance, mining cross-section on second look. Survives 16px favicon rendering. Composes well in horizontal lockup with the wordmark. Single-colour print survives. Distinctive in a sea of generic SaaS marks. |

The strata bands also resonate beyond literal mining: ledger entries, decision strata, generational succession. The brand is mining-rooted but estate-scale.

## 2. Construction grid

Master canvas: 64 x 64.
All anchor points land on whole or half units.

Spine of the B (the lit pillar):
- Rect at `x=14, y=12, width=8, height=40, rx=2`
- Top-edge specular highlight inset 0.4u for the lamp-on sheen

Upper bowl band (the narrower stratum):
- `M22 14 H38 a8 8 0 0 1 8 8 v3 a8 8 0 0 1 -8 8 H22 z`
- Tapers to `width=24, height=20`

Mid divider seam (the geological band line):
- Rect at `x=22, y=32, width=20, height=1, opacity=0.9, fill=#E5B26B`

Lower bowl band (the wider stratum, the ore body):
- `M22 35 H40 a10 10 0 0 1 10 10 v0 a10 10 0 0 1 -10 10 H22 z`
- Three internal hairline strata lines reinforce the cross-section read
- Hairline outline grounds the bowl curve

The clear-space ratio: `1x` the mark's height on every side. At a 32px render, no other element may sit within 32px of the mark in any direction.

## 3. Color variants

The Borjie palette is navy (`#17100A`) + gold (`#E5B26B`) + cream (`#F5EBD8`).

Gold ramp used in the full-colour mark:
- `#FFE2B4` — bright top of spine, brightest stratum
- `#F2C27E` — upper bowl base, mid-spine
- `#E5B26B` — signal mid-tone, seam line
- `#A26A2A` — bottom of spine
- `#7A4F1E` — bottom of lower bowl, ground line

Five tones supported by `BorjieLogo`:

| Tone | Use |
|---|---|
| `full` | Default. Hero, app icons, marketing surfaces, splash. |
| `knockout` | White-on-transparent. Over-photo, ads, banner ads. |
| `mono-gold` | Single gold (`#E5B26B`). Single-colour print, embossing. |
| `mono-navy` | Single navy (`#17100A`). Light-mode contexts, regulator forms. |
| `mono-cream` | Single cream (`#F5EBD8`). Dark-mode tight-contrast contexts. |

## 4. Lockups

Four variants are shipped:

- `mark` — mark only, square slot
- `wordmark` — wordmark only, no mark
- `lockup-horizontal` — mark left of wordmark; default for nav, headers
- `lockup-stacked` — mark above wordmark; app icons, splash, modals

The wordmark sets "Borjie" in Fraunces display medium (600 weight), `-0.018em` tracking, with a subtle warm-gold dot accent between "Bor" and "jie".

## 5. Do not

- Do not recolour outside the palette above
- Do not stretch the mark (uniform-scale only)
- Do not rotate the mark
- Do not apply drop shadows, blurs, glows, or filters beyond what BorjieLogo's `full` tone already provides
- Do not place the mark inside a different shape (no circles, no shields, no squircles unless using the canonical apple-touch tile)
- Do not place the mark over a busy photo without first rendering it with the `knockout` tone
- Do not separate the two bowls of the B or animate them independently
- Do not pair the wordmark with any other typeface for the brand name

## 6. Component API

`packages/design-system/src/brand/BorjieLogo.tsx`

```ts
interface BorjieLogoProps {
  variant?: 'mark' | 'wordmark' | 'lockup-horizontal' | 'lockup-stacked'
  size?: number          // default 32, mark diameter; wordmark scales off this
  tone?: 'full' | 'knockout' | 'mono-gold' | 'mono-navy' | 'mono-cream'
  label?: string         // default 'Borjie'
  title?: string         // default 'Borjie' — accessible title for the mark
}
```

`<BorjieLogo variant="mark" size={32} tone="full" />` is the canonical default.

Legacy callers continue to work — `Logomark`, `Wordmark`, `WordmarkStacked`, `WordmarkOnly` are now thin shims that forward into `BorjieLogo` with the appropriate variant/tone. `BorjieMark` in `@borjie/chat-ui` inlines the same SVG (so the chat island bundle stays decoupled from design-system).

## 7. Shipped assets

`packages/design-system/src/brand/`:

- `BorjieLogo.tsx` — the canonical React component
- `borjie-mark.svg` — mark only, 64 x 64 viewBox
- `borjie-wordmark.svg` — wordmark only, 280 x 80
- `borjie-lockup-horizontal.svg` — horizontal lockup, 380 x 80
- `borjie-lockup-stacked.svg` — stacked lockup, 240 x 220
- `borjie-favicon-16.svg` — 16px micro-render
- `borjie-favicon-32.svg` — 32px favicon
- `borjie-favicon-48.svg` — 48px favicon
- `borjie-apple-touch-180.svg` — Apple touch icon tile, 180 x 180
- `borjie-og-1200x630.svg` — social-share card

Each web app's `public/` folder receives (generated by `scripts/build-brand-assets.mjs`):

- `favicon.ico` — multi-resolution ICO (16, 32, 48)
- `favicon.svg` — modern browsers prefer this
- `favicon-16.svg`, `favicon-32.svg`, `favicon-48.svg` — explicit sizes
- `apple-touch-icon.png` — 180 x 180 raster
- `apple-touch-icon.svg` — SVG source for iOS 16+
- `icon-192.png` — PWA 192px
- `icon-512.png` — PWA 512px
- `icon-maskable-512.png` — PWA maskable 512px
- `og-image.png` — 1200 x 630 social-share card
- `og-image.svg` — SVG source

Each Expo mobile app's `assets/` folder receives (generated by `scripts/build-mobile-brand-assets.mjs`):

- `icon.png` — 1024 x 1024 master icon, midnight tile
- `adaptive-icon.png` — 1024 x 1024 transparent foreground (Android composites)
- `splash.png` — 1242 x 2436 splash with centred mark
- `favicon.png` — 48 x 48 Expo web

## 8. Where it renders

Every surface that previously rendered the placeholder gold orb / "BN" monogram / inline gradient circle now renders the canonical `BorjieLogo`:

| Surface | Component | Variant |
|---|---|---|
| Marketing nav (left edge) | `apps/marketing/src/components/Nav.tsx` | `lockup-horizontal` |
| Marketing footer (top band) | `apps/marketing/src/components/Footer.tsx` | `lockup-horizontal` |
| Marketing hero chat inset bubble | `apps/marketing/src/components/Hero.tsx` | `mark` |
| Marketing hero chat header | `apps/marketing/src/components/Hero.tsx` | `mark` |
| Owner cockpit sidebar | `apps/owner-web/src/components/owner-shell/Sidebar.tsx` (via `Logomark` shim) | `mark` |
| Owner secondary sidebar | `apps/owner-web/src/components/OwnerSidebar.tsx` (via `Logomark` shim) | `mark` |
| Admin console top nav | `apps/admin-web/src/components/internal/ConsoleTopNav.tsx` (via `Logomark` shim) | `mark` |
| Admin staff nav | `apps/admin-web/src/components/StaffNav.tsx` (via `Logomark` shim) | `mark` |
| Admin sidebar | `apps/admin-web/src/components/admin-shell/Sidebar.tsx` (via `Logomark` shim) | `mark` |
| Floating Borjie widget FAB | `packages/chat-ui/src/borjie/FloatingAskBorjie.tsx` (via `BorjieMark` shim) | `mark` |
| Chat panel header | `packages/chat-ui/src/borjie/BorjieChatPanel.tsx` (via `BorjieMark` shim) | `mark` |
| Assistant bubble | `packages/chat-ui/src/borjie/BorjieChatBubble.tsx` (via `BorjieMark` shim) | `mark` |
| Marketing favicon (browser tab) | `apps/marketing/public/favicon.ico` + `favicon.svg` | favicon |
| Owner cockpit favicon | `apps/owner-web/public/favicon.ico` + `favicon.svg` | favicon |
| Admin console favicon | `apps/admin-web/public/favicon.ico` + `favicon.svg` | favicon |
| Marketing OG social share | `apps/marketing/public/og-image.png` | OG |
| Owner OG social share | `apps/owner-web/public/og-image.png` | OG |
| Admin OG social share | `apps/admin-web/public/og-image.png` | OG |
| iOS home-screen icon (marketing) | `apps/marketing/public/apple-touch-icon.png` | iOS tile |
| Android adaptive icon (workforce-mobile) | `apps/workforce-mobile/assets/adaptive-icon.png` | Android adaptive |
| iOS icon (workforce-mobile) | `apps/workforce-mobile/assets/icon.png` | iOS app icon |
| Splash (workforce-mobile) | `apps/workforce-mobile/assets/splash.png` | splash |
| Android adaptive icon (buyer-mobile) | `apps/buyer-mobile/assets/adaptive-icon.png` | Android adaptive |
| iOS icon (buyer-mobile) | `apps/buyer-mobile/assets/icon.png` | iOS app icon |
| Splash (buyer-mobile) | `apps/buyer-mobile/assets/splash.png` | splash |

## 9. Regeneration

When the source SVGs change:

```bash
# Web favicon / PWA / OG raster generation
node scripts/build-brand-assets.mjs

# Expo icon + splash + adaptive-icon raster generation
node scripts/build-mobile-brand-assets.mjs
```

Both scripts are idempotent.
