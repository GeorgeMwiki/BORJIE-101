# LitFin Mobile DNA Spec

Last updated: 2026-05-28
Audience: workforce-mobile (Expo) + buyer-mobile (Expo) implementers.
Source: LitFin web app at
`/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Claude Projects/LITFIN PROJECT/`
(LitFin's "mobile" surface is Flutter and out of scope; this spec
translates LitFin's web DNA into React Native measurements).

The goal: every screen across `apps/workforce-mobile/` and
`apps/buyer-mobile/` reads pixel-equivalent to LitFin's borrower
portal, with Borjie navy/gold preserved and mining-estate copy on
top of the LitFin chrome.

## 1. Tokens

### 1.1 Colour ladder

```
bgBase        navy / midnight slate         #0B0F19 ish (colors.earth900)
bgSurface     primary background            colors.earth800
bgRaised      raised card                   colors.earth700
bgMuted       hairline / muted block        colors.earth500
bgHover       pressed bridge                #15192a
textPrimary   cream off-white body          colors.text
textSecondary sand body on slate            #D8D6CB
textMuted     slate grey meta               colors.textMuted
textInverse   navy ink on cream             colors.textInverse
gold          warm signal                   #FFC857
goldDeep      pressed gold                  colors.goldDark
goldSoft      soft gold tone                colors.goldLight
goldRing      outer ring                    rgba(255, 200, 87, 0.32)
success       emerald                       colors.success
warn          warm amber                    colors.warn
danger        warm red                      colors.danger
border        white/8 hairline              rgba(255, 255, 255, 0.08)
borderStrong  white/16 hairline             rgba(255, 255, 255, 0.16)
borderGold    gold outline                  rgba(255, 200, 87, 0.40)
```

### 1.2 Radius ramp

`xs=8 sm=12 md=16 lg=20 xl=24 pill=999`

LitFin web cards use `rounded-3xl` which translates to **24px** (xl).
Buttons use **pill** (999). Inputs use **md** (16). Chips use
**pill**. Skeletons use **sm** (12).

### 1.3 Spacing scale (8pt grid)

`px=1 xs=4 sm=8 md=12 lg=16 xl=24 xxl=32 xxxl=48`

Outer screen padding: **24** horizontal, **16** vertical bottom on
scroll content. Card padding: **24** (xl) when padded.
Form field spacing: **16** between fields. Hero stack gap: **8**
between eyebrow + title, **12** title + subtitle.

### 1.4 Type ramp (Syne for display, Inter for body)

LitFin uses Syne (variable, 600-800) for display headlines and Inter
(400-700) for body. RN defaults to system fonts; Borjie inherits the
closest extra-bold sans. Sizes:

```
hero       40 / 44   -1.0  800
h1         32 / 38   -0.8  700
h2         24 / 30   -0.6  700
h3         20 / 26   -0.4  600
section    18 / 24   -0.2  600
body       16 / 24    0    400
bodyStrong 16 / 24    0    600
bodySm     14 / 20    0    400
bodySmStrong 14 / 20  0    600
micro      12 / 16   +0.4  500
eyebrow    11 / 14   +1.4  700  UPPERCASE
```

### 1.5 Shadow recipes (RN flat model)

```
card   offset {0,10}   opacity .35  radius 18  elevation 8   colour #000
glow   offset {0,4}    opacity .22  radius 16  elevation 6   colour #FFC857
```

`glow` is reserved for primary CTAs and the hero AI bubble.

## 2. Surface chrome

### 2.1 Splash

- Background: bgBase (#0B0F19 navy slate)
- Wordmark: "BORJIE" 32px / 800 / letter-spacing 6 / gold
- Tagline: body 16 / textSecondary, centred, marginTop 12
- Spinner: gold ActivityIndicator, marginTop 24
- Optional brand mark above wordmark when reveal animation lands

### 2.2 Auth screen chrome

- SafeAreaView edges top/left/right
- Background bgSurface (earth800)
- Padding 24 horizontal
- Hero block: LitFinPageHero with eyebrow "BORJIE / Sign in"
- Input chrome: border rgba(255,255,255,.08), bg earth700, padding
  12/14, radius md (16), text textPrimary, placeholder textMuted
- Focus ring: borderColor gold + shadowColor gold opacity .22
- Error inline: danger colour, micro size, marginTop xs (4)
- Primary CTA: pill, gold fill, full width, lg size, glow shadow

### 2.3 Tab bar

- Height: 64
- Background: bgSurface earth800
- Top border: 1px rgba(255,255,255,.08)
- Active label: gold #FFC857, micro 12 / 700
- Inactive label: textMuted, micro 12 / 500
- Active icon tinted gold; inactive textMuted
- Optional gold pill backdrop behind active label: bg
  rgba(255,200,87,.12), border rgba(255,200,87,.32), radius pill,
  paddingV 4 / paddingH 10
- Badge: 16x16 pill, danger fill, cream text, top-right of icon

### 2.4 Greeting card / hero (LitFinPageHero)

```
eyebrow   gold uppercase + spacing 1.4
title     h1 32 / 700 cream
subtitle  body 16 / textSecondary, maxWidth 520
actions   row, gap sm, marginTop lg
```

Hero pattern on home: eyebrow uses bilingual time-aware greeting via
`greet(lang, name)`; title carries the role intent ("Tovuti zako",
"Wachimbaji wa zamu"); subtitle carries the mining-estate sub-context.

### 2.5 KPI tile

- 24px radius, bg bgRaised, border white/8, padding 16
- Top row: label micro uppercase textMuted + delta badge (right)
- Mid row: value h2 24 / 700 cream
- Bottom row: caption bodySm textSecondary
- Pressable variant lifts on press (scale .98 opacity .94)

### 2.6 Card (LitFinCard)

- Radius xl (24), border white/8, bg earth700, padding 16-24
- Tones add 2px top border accent: gold / success / danger
- Drop shadow `tokens.shadow.card`

### 2.7 Button variants

| Variant   | Bg          | Border       | Fg          | Shadow |
| --------- | ----------- | ------------ | ----------- | ------ |
| primary   | gold        | goldDeep     | navy        | glow   |
| secondary | bgRaised    | borderGold   | gold        | -      |
| ghost     | transparent | border       | textPrimary | -      |
| danger    | danger      | danger       | textPrimary | -      |

Sizes:
```
sm  pad 12/8   minH 36  font 14
md  pad 16/12  minH 44  font 15
lg  pad 24/14  minH 52  font 16
```

### 2.8 Badge

Pill, padding 8/2, bodySmStrong text. Tones: gold / success / danger
/ neutral / info — each uses bg at 12 % opacity over tone colour
with full opacity text + 32 % border.

### 2.9 Chat bubble

- AI bubble: bg aiBubbleBg #11151F, border aiBubbleBorder
  rgba(255,200,87,.22), 24px radius, 2px gold top border, padding 16
- User bubble: bg gold #FFC857, navy text, 24px radius, padding 16,
  alignSelf flex-end, maxWidth 80 %
- Thinking dots: 3 dots, 6px, gold, animated opacity 0.3->1 in 600ms
  staggered
- System notes: textMuted micro, centred

### 2.10 Composer row

- Background bgSurface, padding 12, borderTop white/8
- Input pill: 999 radius, bg bgRaised, padding 16/12, body 16,
  placeholder textMuted
- Mic icon button: 40x40 circle, bgRaised border white/8, gold mic
- Image icon button: same chrome, textSecondary leaf icon
- Send button: 44x44 circle, gold fill, navy arrow, glow shadow
- Keyboard-aware via KeyboardAvoidingView (behaviour padding on iOS)

### 2.11 Empty state

- centred VStack, padding xl
- Illustration plate: 96x96 circle bg earth700 with gold icon
- Title h3 cream marginTop lg
- Body textSecondary marginTop xs, maxWidth 320
- CTA primary marginTop lg

### 2.12 Loading

LitFinSkeleton:
- bg earth700, radius sm (12)
- Animated opacity 0.5->1 via Animated.loop, 1200ms cycle

Stack helper renders n rows of skeletons at given heights.

### 2.13 Bottom sheet

- handle 36x4 textMuted, marginTop 8, marginBottom 16, centred
- bg bgSurface, borderTop white/8, radius top-only xl (24)
- 16-24 padding
- spring open via Animated.spring (damping 18, stiffness 220)

### 2.14 Segmented control

- bg bgRaised, padding 4, radius pill
- segment: padding 12/8, body 14 / 600
- active segment: bg gold, fg navy
- inactive: bg transparent, fg textSecondary

### 2.15 Drawer

- side: right
- width 88 % of screen
- bg bgSurface, borderLeft white/8, top safearea
- close button top-right, gold
- header: eyebrow + title

### 2.16 Toast

- positioned bottom 48
- pill: 999 radius, padding 16/12, body 14 / 600
- tones: success / warning / critical / info each with bg at 16 %
- left icon dot in tone colour

### 2.17 404 / error / offline

- bgBase background full
- Centred VStack
- Icon plate (96 circle, gold accent)
- Title h2 cream
- Body textSecondary maxWidth 320
- Primary CTA (Retry / Go home)
- Offline variant: warn tone, gold icon, body explains offline-first
  caching

## 3. Bilingual greeting helper

`greet(lang, name?)` returns time-aware EN/SW openers. EN: "Good
morning/afternoon/evening, <name>." SW: "Habari za asubuhi/mchana
/jioni, <name>." Never "Karibu" in EN.

Hooked into every screen that opens with a greeting line: splash
tagline, home hero eyebrow, ask/chat first AI message, dispatch
board header, FX desk welcome card, shift-control opener, marketplace
home, KYC home, buyer home.

## 4. Mining-estate copy register

- Owner / manager surfaces speak in mining-estate framing:
  "Estate", "Sites", "Production", "Headframe", "Concessions",
  "Provenance", "Off-take".
- Workforce surfaces speak in worker framing: "Shift", "Site",
  "Drill log", "Safety", "Pay-slip".
- Buyer surfaces speak in mineral-marketplace framing: "Parcel",
  "Bid", "Provenance", "Off-take", "Settlement", "Chain of custody".

## 5. Shared primitives

The web `@borjie/design-system` package is tsup-compiled with the
`"use client"` Next.js boundary baked into the bundle, so it cannot
import React Native modules. To keep the mobile primitives symmetric
across both Expo apps without breaking the web build, we duplicate
the LitFin RN primitives into each app's `src/ui-litfin/` and keep
the API surface identical. Both apps export the same names with the
same prop shapes.

Primitives added in this pass (to both apps):

- `LitFinSplash` - animated splash with brand reveal
- `LitFinBottomSheet` - RN bottom sheet for forms/confirmations
- `LitFinSegmented` - segmented control
- `LitFinDrawer` - RN drawer for detail navigation
- `LitFinToast` - toast variants (success/warning/critical/info)
- `LitFinErrorState` - 404 / generic error
- `LitFinOfflineBanner` - offline indicator
- `LitFinField` - input with focus ring, error inline
- `LitFinFormRow` - form row helper

Existing primitives already symmetric across both apps:
`LitFinCard / LitFinButton / LitFinBadge / LitFinPageHero /
LitFinKpiTile / LitFinChatBubble / LitFinEmptyState /
LitFinThinkingDots / LitFinSkeleton / LitFinAvatar`.

## 6. RN equivalents for LitFin web idioms

| LitFin web                              | RN equivalent                            |
| --------------------------------------- | ---------------------------------------- |
| `bg-navy/60 backdrop-blur-xl`           | `bg earth700` + tokens.shadow.card       |
| `rounded-3xl`                           | `borderRadius: tokens.radius.xl` (24)    |
| `border-t border-gold`                  | `borderTopWidth: 2 borderTopColor: gold` |
| `bg-gold/20`                            | `bg rgba(255,200,87,.12)`                |
| `shadow-glow` (Tailwind ring)           | `tokens.shadow.glow`                     |
| `font-display tracking-tight`           | `tokens.type.h1 / h2 / hero`             |
| `hover:bg-gold/30`                      | `Pressable pressed state opacity`        |
| `backdrop-blur-md`                      | Drop the blur; layer translucent slate   |

## 7. Mapping table — Borjie mobile screen -> LitFin reference

| Borjie file                                                          | LitFin reference                                                     |
| -------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `apps/workforce-mobile/app/index.tsx` (splash)                       | `src/app/(marketing)/page.tsx` hero block                            |
| `apps/workforce-mobile/app/onboarding/welcome.tsx`                   | `src/features/borrower-portal/components/onboarding/OnboardingOverlay.tsx` |
| `apps/workforce-mobile/app/onboarding/phone.tsx`                     | `src/components/auth/*` phone screen                                 |
| `apps/workforce-mobile/app/(tabs)/_layout.tsx` (tab bar)             | `src/features/borrower-portal/components/portal-shell` tab nav       |
| `apps/workforce-mobile/app/(tabs)/home.tsx`                          | `src/features/borrower-portal/components/dashboard` hero card        |
| `apps/workforce-mobile/app/(tabs)/dashboard.tsx`                     | `src/features/dashboards/DashboardView.tsx`                          |
| `apps/workforce-mobile/app/(tabs)/ask.tsx` (chat)                    | `src/features/borrower-portal/components/unified-chat`               |
| `apps/workforce-mobile/app/owner/*`                                  | `src/components/spotlight` + dashboards                              |
| `apps/buyer-mobile/app/index.tsx` (splash)                           | LitFin hero block                                                    |
| `apps/buyer-mobile/app/auth/login.tsx`                               | LitFin auth screen                                                   |
| `apps/buyer-mobile/app/(tabs)/marketplace/index.tsx`                 | LitFin marketplace `src/components/marketplace`                      |
| `apps/buyer-mobile/app/(tabs)/profile/index.tsx`                     | LitFin borrower profile                                              |
| `apps/buyer-mobile/app/chat/index.tsx`                               | LitFin unified-chat                                                  |
| `apps/buyer-mobile/app/marketplace/[id].tsx` (parcel detail)         | LitFin marketing/detail page                                         |

## 8. Implementation order

1. spec doc (this file)
2. shared mobile primitives in `packages/design-system/src/native/`
3. workforce splash + auth (welcome / phone / identity / role-detect /
   safety / certifications / biometric / calibration / done) brought
   to LitFinPageHero shell
4. workforce tab bar -> tab bar spec
5. workforce home / dashboard / ask / sites / cash / decisions /
   docs / field / people / sites tabs to LitFin chrome
6. workforce role-specific detail screens (owner O-M-*, worker W-M-*)
7. buyer splash + auth
8. buyer tabs + detail screens
9. mining-estate copy sweep
10. typecheck (both apps)

## 9. Constraints recap

- TS strict, 0 errors per filter
- bilingual sw / en, EN never "Karibu", time-aware greetings on every
  greeting line
- no em-dashes anywhere
- Borjie navy / gold preserved
- file <800 lines, function <50 lines, nesting <=4

## 10. Verification

```
pnpm install
pnpm --filter @borjie/design-system build
pnpm --filter @borjie/chat-ui build
pnpm --filter @borjie/workforce-mobile exec tsc --noEmit
pnpm --filter @borjie/buyer-mobile exec tsc --noEmit
```
