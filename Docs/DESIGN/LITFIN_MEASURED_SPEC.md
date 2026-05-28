# LitFin marketing , measured visual spec

This document captures the *exact* Tailwind utility values, CSS custom
property values, framer-motion props, gradient stops, shadow recipes
and DOM rhythm of LitFin's `(marketing)` route tree, observed from
read-only inspection of:

- `apps/(marketing)/layout.tsx`
- `apps/(marketing)/page.tsx`
- `components/marketing/MainNav.tsx`
- `components/marketing/IgnitionHero.tsx`
- `components/marketing/MarketingFooter.tsx`
- `components/marketing/CapabilitiesSection.tsx`
- `components/home/HomePage.tsx`
- `components/home/sections/{Ecosystem,UniversalAccess,AIOfficerTabs,InteractiveModes,PlatformShowcase,InsightsAndScale,RoadmapCTA}Section.tsx`
- `components/home/BentoGrid.tsx`
- `app/globals.css`

Borjie reproduces every measurement here. The only legal difference is
**brand colour** , Borjie keeps navy + gold; LitFin keeps copper +
cream. See `## Section 16` for the colour swap mapping.

---

## 1. Container / layout tokens

| Token                                       | LitFin value                                     |
|---------------------------------------------|--------------------------------------------------|
| Nav inner max-width                         | `max-w-[1440px]`                                 |
| Marketing page section max-width            | `max-w-7xl` (1280px)                             |
| Standard section vertical padding           | `py-16 md:py-24`                                 |
| Section horizontal padding                  | `px-5` (mobile) , section inner uses `px-5`      |
| Hero outer padding                          | `px-5 pt-16 md:pt-24 pb-20`                      |
| Hero min-height                             | `min-h-[88vh]`                                   |
| Hero column grid                            | `md:grid md:grid-cols-[1.15fr_1fr] md:gap-12 lg:gap-16` |
| 3-up card grid                              | `grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5 lg:grid-cols-3` |
| Footer inner max-width                      | `max-w-[1440px]`                                 |
| Footer outer padding                        | `px-4 py-16 sm:px-6`                             |
| Footer wrapper card padding                 | `p-6 md:p-8`                                     |
| Mega-menu width                             | `w-[820px]` (audience), `w-[300px]` (about)      |
| Marketing layout top-pad to clear nav       | `pt-16` on `<main>`                              |

---

## 2. Border radii

LitFin uses a tight ladder dominated by `rounded-[28px]` for the hero
chat shell and major marketing panels, and `rounded-2xl` for cards.

| Use                                       | Value                  |
|-------------------------------------------|------------------------|
| Hero chat shell                           | `rounded-[28px]`       |
| Marketing hero panel utility              | `rounded-[32px]`       |
| Marketing section surface utility         | `rounded-[30px]`       |
| Marketing highlight band                  | `rounded-[28px]`       |
| Marketing elevated card                   | `rounded-[28px]`       |
| Standard card                             | `rounded-2xl` (16px)   |
| Card-premium / card-glass / card-glow     | `rounded-2xl`          |
| Bento item                                | `rounded-3xl`          |
| Dashboard hero / dashboard page           | `rounded-[28px]` / `rounded-[30px]` |
| Dashboard section                         | `rounded-[24px]`       |
| Button (premium)                          | `rounded-xl` (12px)    |
| Button (nav / chip)                       | `rounded-lg` (10px)    |
| Pill / chip                               | `rounded-full`         |
| Brand mark inner ring                     | `rounded-full`         |
| Sidebar nav item                          | `rounded-xl`           |
| Composer input shell                      | `rounded-xl`           |
| Composer circular send button             | `rounded-full`         |
| Mobile nav cards                          | `rounded-xl`           |
| CSS variable base                         | `--radius: 0.625rem` (10px) |

---

## 3. Typography ramp

LitFin uses two font families:

- **Display:** `var(--font-syne)` for headings, hero, kickers.
- **Body:**    `var(--font-inter)` for everything else.

| Role                | Tailwind                                                                              | Letter-spacing / leading |
|---------------------|---------------------------------------------------------------------------------------|--------------------------|
| Hero h1             | `text-5xl md:text-6xl lg:text-7xl font-bold`                                          | `leading-[1.02] tracking-[-0.025em]` |
| Hero subhead        | `text-lg md:text-xl leading-relaxed`                                                  | `text-wrap: pretty`      |
| Section h2 (xl)     | `text-4xl md:text-5xl lg:text-6xl font-extrabold`                                     | `leading-[1.05] tracking-[-0.03em]` |
| Section h2 (md)     | `text-4xl md:text-5xl font-bold`                                                      | `tracking-[-0.025em]`    |
| Section h3 (md)     | `text-3xl md:text-4xl font-semibold`                                                  | `tracking-[-0.025em]`    |
| Card h3             | `text-xl font-semibold`                                                                | `tracking-[-0.015em]`    |
| Card title (sm)     | `text-base font-semibold`                                                             | `tracking-[-0.01em]`     |
| Card body           | `text-sm leading-relaxed`                                                              |                          |
| Kicker / eyebrow    | `text-[11px] font-medium uppercase`                                                   | `tracking-[0.16em]`      |
| Sidebar kicker      | `text-[11px] font-semibold uppercase`                                                 | `tracking-[0.22em]`      |
| Nav item            | `text-sm font-medium`                                                                  |                          |
| Composer field      | `text-sm`                                                                              |                          |
| Hero pill           | `text-xs font-medium`                                                                  |                          |
| Chat bubble body    | `text-sm leading-relaxed`                                                              |                          |
| Chat timestamp      | `text-[10px]`                                                                          |                          |
| Stat value (Bento)  | `text-3xl font-bold tabular-nums`                                                     | `tracking-[-0.025em]`    |
| Body base           | `letter-spacing: -0.011em` on `<body>`                                                |                          |

Heading tracking is always negative (`-0.015em` to `-0.03em`). Kickers
always positive (`0.16em` or `0.22em`).

Font-feature-settings on `<body>`: `"rlig" 1, "calt" 1, "ss01" 1`.

---

## 4. Colours , LitFin tokens (light mode CSS custom properties)

```
--background     40 40% 98%      cream canvas
--foreground     30 14% 12%      warm charcoal
--card           0 0% 100%       white
--primary        24 58% 48%      copper (LitFin's brand colour)
--secondary      35 18% 95%      warm neutral
--muted          35 18% 94%
--accent         28 35% 94%
--destructive    10 68% 36%      burnt red
--success        150 42% 28%     emerald
--warning        36 82% 48%
--info           215 22% 44%
--border         30 10% 89%
--radius         0.625rem        10px
```

Dark mode primary lifts to `24 68% 58%` (brighter copper on charcoal).

**Borjie keeps its OKLCH navy + gold tokens , see Section 16 mapping.**

---

## 5. Gradient recipes (verbatim)

```
--gradient-primary: linear-gradient(135deg, hsl(24 58% 48%) 0%, hsl(14 62% 42%) 100%);
--gradient-accent:  linear-gradient(180deg, hsl(24 58% 48% / 0.04) 0%, transparent 70%);
--gradient-mesh:    radial-gradient(ellipse at top, hsl(24 58% 48% / 0.06) 0%, transparent 60%);
```

Hero ambient wash (left orb):
```
radial-gradient(circle, hsl(24 82% 58% / 0.4) 0%, hsl(24 70% 48% / 0.12) 40%, transparent 72%)
```
applied to a `560px x 560px` div with `blur-3xl opacity-30`, positioned
`-top-40 -left-40 -z-10`.

Hero ambient wash (right orb):
```
radial-gradient(circle, hsl(14 70% 48% / 0.35) 0%, hsl(14 60% 35% / 0.1) 44%, transparent 75%)
```
applied to a `620px x 620px` div with `blur-3xl opacity-25`, positioned
`-bottom-40 -right-40 -z-10`.

Composer SEND button (circular, 40x40):
```
linear-gradient(135deg, hsl(36 86% 64%) 0%, hsl(24 78% 54%) 50%, hsl(14 62% 36%) 100%)
```

CapabilitiesSection per-card hover halo:
```
radial-gradient(circle, hsl(24 82% 60% / 0.5) 0%, transparent 70%)
```
on a 192px square absolutely positioned `-top-24 -right-24` inside the
card, `blur-3xl opacity-0 group-hover:opacity-50 transition-opacity duration-500`.

Chat AI message bubble top hairline (2px):
```
linear-gradient(90deg, hsl(36 86% 64%) 0%, hsl(24 72% 50%) 55%, hsl(14 62% 30%) 100%)
opacity 0.60
```

Brand mark radial:
```
radial-gradient(circle at 30% 30%, hsl(36 92% 72% / 0.55), hsl(24 72% 50% / 0.25) 60%, transparent 85%)
```

Chat AI bubble background (`.chat-ai-bubble`):
```
backdrop-filter: blur(16px);
background-image: linear-gradient(135deg,
  hsl(var(--card) / 0.92) 0%,
  hsl(var(--card) / 0.85) 50%,
  hsl(var(--card) / 0.88) 100%);
```

Dashboard hero gradient:
```
linear-gradient(135deg, hsl(24 40% 16%) 0%, hsl(var(--primary)) 42%, hsl(var(--primary)) 100%)
```

---

## 6. Shadow recipes (verbatim)

```
--shadow-sm:      0 1px 2px 0 rgb(30 20 10 / 0.04)
--shadow-md:      0 4px 8px -2px rgb(30 20 10 / 0.06), 0 2px 4px -2px rgb(30 20 10 / 0.04)
--shadow-lg:      0 12px 24px -6px rgb(30 20 10 / 0.08), 0 4px 8px -4px rgb(30 20 10 / 0.04)
--shadow-xl:      0 24px 48px -12px rgb(30 20 10 / 0.12), 0 8px 16px -8px rgb(30 20 10 / 0.06)
--shadow-glow:    0 0 0 1px hsl(24 58% 48% / 0.08), 0 8px 24px -8px hsl(24 58% 48% / 0.18)
--shadow-glow-lg: 0 0 0 1px hsl(24 58% 48% / 0.12), 0 16px 48px -12px hsl(24 58% 48% / 0.22)
```

Hero chat shell shadow (the big drop):
```
shadow-[0_28px_80px_rgb(15_23_42_/_0.22)]
```
plus `ring-1 ring-border/30 backdrop-blur-2xl`.

Footer enclosing card shadow:
```
shadow-[0_24px_70px_rgb(15_23_42_/_0.06)]
```

Marketing hero panel utility:
```
shadow-[0_28px_90px_rgb(15_23_42_/_0.08)]
```

Marketing section surface:
```
shadow-[0_18px_52px_rgb(15_23_42_/_0.06)]
```

Marketing elevated card:
```
shadow-[0_14px_40px_rgb(15_23_42_/_0.05)]
hover:shadow-[0_18px_46px_rgb(15_23_42_/_0.09)]
```

Composer SEND button:
```
shadow-[0_8px_20px_-4px_hsl(24_72%_50%/0.45),0_2px_6px_hsl(14_62%_30%/0.2)]
hover:shadow-[0_10px_24px_-4px_hsl(24_72%_50%/0.55),0_3px_8px_hsl(14_62%_30%/0.25)]
```

Nav scrolled state:
```
shadow-[0_18px_50px_rgb(15_23_42_/_0.08)]
```

---

## 7. Animation tokens

```
--ease-out-quart: cubic-bezier(0.25, 1, 0.5, 1)
--ease-out-expo:  cubic-bezier(0.16, 1, 0.3, 1)
--ease-spring:    cubic-bezier(0.34, 1.4, 0.64, 1)
--duration-fast:    150ms
--duration-normal:  220ms
--duration-slow:    320ms
```

Scroll-reveal easing (`.scroll-reveal`):
```
transition: opacity 700ms cubic-bezier(0.22, 1, 0.36, 1),
            transform 700ms cubic-bezier(0.22, 1, 0.36, 1);
```

Stagger step (`.scroll-reveal-stagger > .scroll-reveal`):
```
--stagger-step: 80ms (default)
```
per-card index multiplied by step.

Framer-motion conversation turn entry (hero chat):
```
initial:   { opacity: 0, y: 8, x: isUser ? 12 : -12, scale: 0.97 }
animate:   { opacity: 1, y: 0, x: 0, scale: 1 }
transition:{ type: 'spring', stiffness: 320, damping: 24 }
```

Conversation turn fire delays (3-turn choreo): **400ms, 1800ms, 3200ms**.

Framer-motion section reveals (`whileInView`):
```
initial:    { opacity: 0, y: 12 }
animate:    { opacity: 1, y: 0 }
viewport:   { once: true }
transition: { duration: 0.4 }
```

Section staggered card delay: `duration: 0.35, delay: i * 0.06` (60ms).

Marquee logo strip: `animation: marquee 30s linear infinite`
(`--shimmer-angle` swap at 6s linear infinite for shimmer rings).

Logo halo pulse:
```
@keyframes pulse-glow {
  0%, 100% { opacity: 0.72; transform: scale(1); }
  50%      { opacity: 1;    transform: scale(1.4); }
}
animation: pulse-glow 2.6s cubic-bezier(0.4, 0, 0.6, 1) infinite;
```

Mini waveform bar:
```
duration: 1.2 + (i % 3) * 0.2 seconds,
repeat:   Infinity,
ease:     'easeInOut',
delay:    i * 0.05
height:   [4, 8 + Math.sin(i) * 4, 4, 12 - Math.cos(i) * 3, 4]
opacity:  [0.5, 0.9, 0.5, 0.9, 0.5]
```

Floating mark watermark: `animate-float-gentle` (custom keyframe; 6s
ease-in-out infinite via `float-soft`):
```
0%, 100% { transform: translateY(0); }
50%      { transform: translateY(-6px); }
```

Dropdown open (audience / about):
```
initial:    { opacity: 0, y: 8, scale: 0.96 }
animate:    { opacity: 1, y: 0, scale: 1 }
exit:       { opacity: 0, y: 8, scale: 0.96 }
transition: { duration: 0.15 }
```

---

## 8. Hero composition

```
<section class="relative isolate overflow-hidden">
  <!-- 4 ambient layers: mesh wash, left orb, right orb, mark watermark -->
  <div class="mx-auto flex min-h-[88vh] max-w-7xl flex-col items-stretch
              gap-12 px-5 pb-20 pt-16
              md:grid md:grid-cols-[1.15fr_1fr] md:gap-12 md:pt-24
              lg:gap-16">
    <!-- LEFT column -->
    <div class="flex flex-col justify-center">
      <span pill: "inline-flex w-fit items-center gap-2 rounded-full
                   border border-border bg-card/80 px-3 py-1
                   text-xs font-medium text-muted-foreground backdrop-blur-sm" />
      <h1 class="mt-6 text-5xl font-bold leading-[1.02]
                 tracking-[-0.025em] md:text-6xl lg:text-7xl" />
      <p  class="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground md:text-xl" />
      <div class="mt-10 flex flex-col gap-3 sm:flex-row">
        primary Button variant="ignite" size="xl"
        outline Button variant="outline" size="xl"
      </div>
      <div class="mt-10 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs" />
    </div>

    <!-- RIGHT column - live chat inset -->
    <div class="relative flex items-center">
      <div class="relative w-full overflow-hidden rounded-[28px]
                  border border-border/50 bg-background/92
                  shadow-[0_28px_80px_rgb(15_23_42_/_0.22)]
                  ring-1 ring-border/30 backdrop-blur-2xl"
           style="min-height:520px">
        <!-- Header: 48px tall via py-3 + items inside -->
        <div class="flex items-center justify-between border-b border-white/10
                    px-4 py-3" + CHAT_HEADER_GRADIENT>
          <div>brand-tile 36x36 (h-9 w-9) rounded-full bg-primary-foreground/15
               ring-1 ring-primary-foreground/20 shadow-[0_4px_12px_rgb(0_0_0_/_0.1)]
               backdrop-blur-sm</div>
          right cluster: EN-chip + divider + Live pill
        </div>

        <!-- Body: choreographed turns -->
        <div class="space-y-3 px-4 py-3" style="min-height:300px">
          [chat turns from `choreo[]`]
        </div>

        <!-- Disclaimer strip -->
        <div absolute bottom-[88px] inset-x-0 px-4 py-2
             bg-[hsl(36_45%_97%)] backdrop-blur-sm>
          before: top-px gradient hairline transparent->copper->transparent
          ShieldCheck size=12 + AI disclaimer 10px text
        </div>

        <!-- Composer: 88px tall area -->
        <div class="absolute inset-x-0 bottom-0 border-t border-border
                    bg-background/95 px-4 pb-3 pt-3 backdrop-blur-md">
          row: 40x40 mic tile, 40x40 attach tile, flex-1 input shell,
               40x40 circular gradient SEND button
          status row: text-[10px]
        </div>
      </div>
    </div>
  </div>
</section>
```

---

## 9. Nav composition

- `<nav>` is `fixed top-0 left-0 right-0 z-50` with `transition-all duration-300`.
- Default state: `bg-background/72 backdrop-blur-xl border-b border-border/40`.
- Scrolled (>20px) state: `bg-background/92 backdrop-blur-2xl
  shadow-[0_18px_50px_rgb(15_23_42_/_0.08)] border-b border-border/60`.
- Inner row: `h-16 max-w-[1440px] px-4 sm:px-6 gap-2`.
- Logo wrapped in `motion.div` with `whileHover={{scale: 1.02}}` and
  `whileTap={{scale: 0.98}}`.
- Audience mega-menu uses an absolute positioned panel `w-[820px] p-4
  rounded-2xl bg-card border border-border/50 shadow-xl
  backdrop-blur-xl` with `grid-cols-5 gap-4`.
- Right cluster (in order): locale chip pill, ThemeToggle, Sign-in
  ghost button, smart CTA primary button (40px tall via `h-9`),
  mobile menu toggle.
- Mobile drawer: `max-h-[80vh] overflow-y-auto border-t border-border/50 bg-card/95 backdrop-blur-2xl`.

---

## 10. Footer composition

```
<footer class="relative border-t border-border/50 bg-card/80 backdrop-blur-xl">
  <div class="mx-auto max-w-[1440px] px-4 py-16 sm:px-6">
    <!-- Outer wrapper card -->
    <div class="mb-10 rounded-[32px] border border-border/50 bg-background/80
                p-6 shadow-[0_24px_70px_rgb(15_23_42_/_0.06)]
                backdrop-blur-xl md:p-8">
      <!-- Top row: logo + tagline + contact pills -->
      <div class="mb-10 flex flex-col gap-4 border-b border-border/50 pb-8
                  md:flex-row md:items-end md:justify-between">
        Logo + tagline (max-w-2xl)
        Contact pills: email + location, rounded-full border bg-background/85
      </div>

      <!-- 7-column link grid -->
      <div class="grid grid-cols-2 gap-8 md:grid-cols-3 lg:grid-cols-7">
        Brand column (col-span-2 md:col-span-3 lg:col-span-1)
        Then 7 link columns (company, platform, institutions, capabilities,
                              resources, trifoliage, legal)
      </div>
    </div>
  </div>

  <!-- Bottom bar -->
  <div class="border-t border-border/50">
    <div class="mx-auto max-w-[1440px] px-4 py-6 sm:px-6
                flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      compliance badge (emerald)
      copyright + social + admin link
    </div>
  </div>
</footer>
```

---

## 11. Cookie consent composition (LitFin pattern)

LitFin does not ship a cookie banner in the marketing layout (uses a
session cookie + Tanzania DPA disclosure surface). Borjie ships a
bottom-aligned dialog with these measurements:

- Position: `fixed inset-x-0 bottom-0 z-40 px-4 pb-4 sm:px-6 sm:pb-6`.
- Inner card: `mx-auto max-w-3xl rounded-lg border bg-surface/95 p-5
  shadow-2xl backdrop-blur-md sm:p-6`.
- Title: `font-display text-base font-semibold`.
- Body: `text-sm leading-relaxed`.
- Buttons row: settings ghost on left, accept primary on right, both
  `h-10 rounded-md px-4 text-sm font-semibold`.

This matches the spec-derived rhythm , keep as-is.

---

## 12. Chat widget chrome (LitFin Live Fabric)

Numbers extracted from `IgnitionHero.tsx` (the embedded chat panel) +
the LitFin `core/litfin-ai` widget chrome:

| Element                          | Measurement                                                 |
|----------------------------------|-------------------------------------------------------------|
| Shell radius                     | `rounded-[28px]`                                            |
| Shell border / ring              | `border-border/50` + `ring-1 ring-border/30`                |
| Shell drop shadow                | `0 28px 80px rgb(15 23 42 / 0.22)`                          |
| Shell backdrop blur              | `backdrop-blur-2xl`                                         |
| Shell min-height                 | 520px                                                       |
| Header height                    | 48px (`py-3 px-4` + 24px content)                           |
| Header bottom border             | `border-white/10`                                           |
| Brand-tile size                  | 36x36 (`h-9 w-9`) circular                                  |
| Brand-tile background            | `bg-primary-foreground/15`                                  |
| Brand-tile ring                  | `ring-1 ring-primary-foreground/20`                         |
| Brand-tile shadow                | `0 4px 12px rgb(0 0 0 / 0.1)`                               |
| Brand mark inner size            | 20px                                                        |
| EN-chip                          | `text-[11px] font-medium opacity-90`, with small globe icon |
| Live pill                        | `bg-primary-foreground/10 px-2 py-0.5 text-[10px] uppercase`|
| Live dot                         | `h-1 w-1 rounded-full bg-emerald-300 animate-pulse`         |
| Body padding                     | `px-4 py-3`                                                 |
| Bubble (AI) radius               | `rounded-2xl`                                               |
| Bubble (AI) padding              | `px-4 py-2.5`                                               |
| Bubble (AI) text                 | `text-sm leading-relaxed`                                   |
| Bubble (AI) top hairline         | 2px gradient (from `36 86% 64%` to `14 62% 30%`), opacity 60% |
| Avatar (AI)                      | 32x32 (`h-8 w-8`) circular gold radial                      |
| Bubble (user) radius             | `rounded-2xl`                                               |
| Bubble (user) padding            | `px-4 py-2.5`                                               |
| Bubble (user) bg                 | LitFin: copper `CHAT_USER_BUBBLE`; Borjie: navy `signal-500/85`  |
| Disclaimer strip height          | ~32px (py-2)                                                |
| Disclaimer position              | `absolute inset-x-0 bottom-[88px]`                          |
| Disclaimer background            | `bg-[hsl(36_45%_97%)]` + `backdrop-blur-sm`                 |
| Disclaimer top hairline          | gradient transparent→copper(0.4)→transparent, height 1px    |
| Disclaimer icon                  | `ShieldCheck size=12`                                       |
| Disclaimer text                  | `text-[10px] leading-snug tracking-[-0.005em]`              |
| Composer area height             | 88px (`pb-3 pt-3` + 40px input row + 16px status row)       |
| Composer top border              | `border-t border-border`                                    |
| Composer bg                      | `bg-background/95 backdrop-blur-md`                         |
| Mic / attach tile                | 40x40 (`h-10 w-10`) `rounded-xl bg-muted`                   |
| Input shell                      | 40px tall `rounded-xl border bg-background px-3 text-sm`    |
| SEND button                      | 40x40 (`h-10 w-10`) circular gradient                       |
| Status row                       | `text-[10px]`, justify-between                              |
| Thinking-dots animation          | `borjie-bounce` 1.2s ease-in-out infinite, 3 dots staggered 0.12s |
| Mini waveform bar count          | 18                                                          |
| Mini waveform bar width          | 2px                                                         |
| Mini waveform bar fill           | `bg-primary/60`                                             |

---

## 13. Marketing page section order (LitFin's `(marketing)/page.tsx`)

LitFin marketing renders, in order:

1. **MainNav** (fixed at top)
2. **IgnitionHero** (Live Fabric two-column: claim + chat inset)
3. **BrainClaimsBanner** (evidence-backed claim strip)
4. **CapabilitiesSection audience="platform"** (6 capability tiles)
5. *HomePage* fragment containing:
   1. Frontier banner band (`bg-primary/5 py-10`)
   2. Why-credit-business duo (2-up problem / solution)
   3. EcosystemSection (gaps grid + ripple effect)
   4. UniversalAccessSection (multi-language / multi-device / multi-role)
   5. AIOfficerTabsSection (tabbed showcase , Mr. Mwikila modes)
   6. InteractiveModesSection (marketing chat · home chat · voice)
   7. BentoGrid (5 asymmetric feature tiles)
   8. PlatformShowcaseSection (3 product surfaces)
   9. InsightsAndScaleSection (CountUp stats + pilot quote cards)
   10. RoadmapCTASection (geographic roadmap + final CTA + contact)
6. **MarketingFooter**
7. **MarketingWidgetSlot** (lazy-mounted AI chat FAB)

---

## 14. Roadmap / Final CTA / Contact composition

Geographic roadmap (`RoadmapCTASection`):
- Section padding `py-16 md:py-24 px-5`.
- Heading kicker eyebrow `text-[11px] font-medium uppercase tracking-[0.16em] text-primary`.
- Heading `text-3xl md:text-4xl font-semibold tracking-[-0.025em]`.
- Grid `md:grid-cols-2 lg:grid-cols-4 gap-4`.
- Each stage Card has `h-full p-6 rounded-2xl border bg-card` with a
  stage pill `text-[11px] uppercase tracking-[0.16em] px-2 py-0.5 rounded-md`
  and an active emerald pulsing dot `h-1.5 w-1.5 bg-success animate-pulse`.

Final CTA (centered):
- Max-w `max-w-3xl`.
- Kicker, h2 `text-3xl md:text-4xl font-semibold`, sub `text-base max-w-xl`.
- Dual button row, primary variant `ignite` size `xl`, secondary outline.

Contact / Support: two-card row, each `Card variant="interactive"
h-full p-8 flex flex-col`.

---

## 15. Capabilities section composition

```
<section class="relative isolate overflow-hidden py-16 md:py-24 px-5
                border-t border-border bg-card/40">
  ambient orb top-left, watermark mark top-right (animate-float-gentle)

  <div class="relative mx-auto max-w-7xl">
    <div class="mb-10 md:mb-14 flex max-w-3xl items-start gap-4">
      LitfinMark size=36 tone=gradient glow
      kicker text-[11px] uppercase tracking-[0.16em]
      h2 text-4xl md:text-5xl lg:text-6xl font-extrabold
         tracking-[-0.03em] leading-[1.05]
      sub text-base md:text-lg leading-relaxed
    </div>

    <div class="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5 lg:grid-cols-3
                scroll-reveal-stagger">
      article scroll-reveal group relative overflow-hidden rounded-2xl
              border border-border bg-card p-5 shadow-[var(--shadow-sm)]
              transition duration-300
              hover:-translate-y-1 hover:border-primary/50
              hover:shadow-[var(--shadow-glow)]
        per-card halo (top-right, 192px square, blur-3xl, opacity 0->50)
        icon tile h-10 w-10 rounded-md bg-primary/10
        h3 text-base font-semibold tracking-[-0.01em]
        p  text-sm leading-relaxed
    </div>
  </div>
</section>
```

---

## 16. Borjie colour swap mapping (the only legal divergence)

| LitFin                                          | Borjie equivalent (OKLCH navy + gold) |
|-------------------------------------------------|---------------------------------------|
| `hsl(24 58% 48%)` copper primary                | `oklch(0.78 0.17 78)` warm gold        |
| `hsl(24 68% 58%)` dark-mode copper              | `oklch(0.86 0.16 80)` bright gold      |
| `hsl(14 62% 42%)` deep copper gradient end      | `oklch(0.58 0.12 65)` deep gold        |
| `hsl(36 92% 72%)` gold accent                   | `oklch(0.86 0.16 80)` bright gold      |
| `hsl(40 40% 98%)` cream canvas                  | `oklch(0.16 0.025 260)` deep navy ink  |
| `hsl(30 14% 12%)` warm charcoal                 | `oklch(0.94 0.01 95)` cream foreground |
| Composer SEND button gradient                   | `linear-gradient(135deg, oklch(0.86 0.16 80) 0%, oklch(0.78 0.17 78) 50%, oklch(0.58 0.12 65) 100%)` |
| Brand mark radial                               | `radial-gradient(circle at 30% 30%, oklch(0.86 0.16 80 / 0.55), oklch(0.58 0.12 65 / 0.25) 60%, transparent 85%)` |

Every other token (radii, shadows, animation timings, typography ramp,
section padding, grid layout) is identical.

---

## 17. Section-by-section content reframe (Borjie mining-estate scope)

LitFin sells a *credit business operating system*. Borjie sells a
**mining estate operating system**. Every section's copy reframes
around the **entire mining estate**, not just on-mine operations:

| LitFin theme                       | Borjie reframe                                                    |
|------------------------------------|-------------------------------------------------------------------|
| Borrower readiness                 | Operator readiness across PML/ML/SML licence ladder               |
| Credit officers, banks, MFIs       | Mining owners, managers, supervisors, employees                   |
| Mining commission as regulator     | Tumemadini, NEMC, BoT, TRA, BRELA, LBMA as connected counterparts |
| Group lending (VICOBA)             | Cooperatives + AMCOS + holdings + subsidiaries                    |
| Lender matching                    | Off-taker / buyer matching                                        |
| 12 business domains                | 7 Mr. Mwikila modes (Build / Strategy / Operations / Document / Finance / Risk / Compliance) |
| Universal credit access            | Universal mining-estate access (PML / ML / SML / cooperatives + holdings + ancillary businesses: transport / catering / fuel / retail / real estate / equipment rental + family office + succession + asset register) |

The Hero headline pattern:

- **LitFin:** "The world's first **AI-native** Credit Business Operating System."
- **Borjie:** "The world's first **AI-native** Mining Estate Operating System."

(Borjie already ships "Run your mine on autopilot" as the marketing
short-form. The expanded "mining estate" framing extends to every
section copy.)

---

End of measured spec.
