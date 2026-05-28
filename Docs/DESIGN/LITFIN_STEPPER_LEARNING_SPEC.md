# LitFin Stepper Learning Chat — Measured Spec

**Captured:** 2026-05-28
**Sources read (LitFin, structural reference only):**

- `src/shared/learning-smartboard/LearningSmartboard.tsx` (172 lines)
- `src/shared/learning-smartboard/LearningSidebar.tsx` (322 lines)
- `src/features/borrower-portal/components/smartboard/SmartboardBridgedChat.tsx` (203 lines)
- `src/features/borrower-portal/components/unified-chat/UnifiedChatMessages.tsx` (1103 lines)
- `src/features/borrower-portal/components/unified-chat/UnifiedChatHeader.tsx` (704 lines)
- `src/features/borrower-portal/components/unified-chat/UnifiedChatInput.tsx` (511 lines)
- `src/features/borrower-portal/components/unified-chat/StepBracketDivider.tsx` (163 lines)
- `src/features/borrower-portal/components/unified-chat/StepProgressChecklist.tsx` (529 lines)
- `src/core/litfin-ai/generative-ui/blocks/ConceptCard.tsx` (1032 lines)

**Purpose:** measured, source-traceable spec used to author fresh Borjie
JSX that lands at the same visual outcome. Borjie navy/gold tokens
replace LitFin copper/teal; everything else is dimensionally identical.

This is reference-only. No LitFin code is copied. Every numeric value
below is observed in the LitFin source.

---

## 1. Outer layout

Pattern: split-pane, sidebar-fixed, main-flex-1.

| Region | Width | Behaviour |
|---|---|---|
| Left rail (`LearningSidebar`) | `w-64` (256px) when open; `~40px` icon strip when collapsed; `hidden md:flex` | Step ladder, mastery rings, overall progress footer |
| Main pane (chat) | `flex-1 h-full overflow-hidden` | Scroll container scrolls; header + input pinned |
| Right rail (optional board) | only when wrapped in `SmartboardLayout` | Out of scope for Borjie home chat |

Outer container: `flex h-full w-full overflow-hidden`.

Borders between regions: `border-r`, `border-white/[0.06]` in dark.

Background tones (dark): sidebar `bg-[hsl(220,18%,8%)]`, main pane
inherits parent. Light: `bg-white` sidebar, neutral main.

---

## 2. Stepper bar / left ladder

`LearningSidebar` is the canonical stepper. Per-step row:

```
[ MasteryRing ]  [ Title                ]
                 [ 12 min · 64%         ]
```

| Element | Value |
|---|---|
| Row gap | `gap-3` |
| Row padding | `px-4 py-3` |
| Title | `text-sm font-medium truncate` |
| Subtext | `text-xs mt-0.5 truncate` |
| Active row | `bg-teal-500/10 border-r-2 border-teal-400` (LitFin teal) → Borjie: `bg-warning/10 border-r-2 border-warning` |
| Locked row | `opacity-40 cursor-not-allowed` |
| Hover | `hover:bg-white/[0.04]` (dark) / `hover:bg-slate-50` (light) |

### Mastery ring (SVG)
| Param | Value |
|---|---|
| `size` | `36px` |
| `strokeWidth` | `3` |
| Stroke colors | complete=`stroke-emerald-500`, ≥0.5=`stroke-amber-400`, >0=`stroke-blue-400`, 0=`stroke-slate-600` → Borjie: complete=`stroke-emerald-500`, ≥0.5=`stroke-warning`, >0=`stroke-warning/60`, 0=`stroke-neutral-700` |
| Background ring | `stroke-slate-700/30`, same stroke width |
| Rotation | `-rotate-90` so 12 o'clock = start |
| Animation | `transition-all duration-500` |
| Check icon when complete | `w-3 h-3 text-emerald-500`, centered |

### Collapsed icon strip
Width `~40px`. Each step: `w-6 h-6 rounded-full border-2`, font
`text-[9px] font-bold`. Active border `border-teal-400` and bg
`bg-teal-400/20` → Borjie warning. Complete: `border-emerald-500
bg-emerald-500/20`.

### Header (sidebar top)
`px-4 py-3 border-b`. Title `text-sm font-semibold truncate`. Icon
`w-4 h-4`. Collapse toggle: `p-1 rounded-md`.

### Footer (overall progress)
`px-4 py-3 border-t`. Label `text-xs font-medium`. Count `text-xs
font-semibold`. Track height `h-1.5 rounded-full overflow-hidden bg-slate-800` (dark) / `bg-slate-200` (light). Fill `bg-teal-500 transition-all duration-500` → Borjie `bg-warning`.

---

## 3. Step bracket divider (in-chat)

Centered, three-column flex with dot ellipses. Used between groups of
messages when each message has a `stepId`.

| Element | Value |
|---|---|
| Outer | `flex items-center gap-3 py-3 select-none` |
| Left/right dot column | `flex items-center gap-1.5 flex-1` + 3 dots `text-[10px] text-muted-foreground/40` |
| Center group | `flex items-center gap-1.5 shrink-0` |
| Status icon | `h-3 w-3` (Check / Zap / Loader2 spinning) |
| Center label | `text-[11px] font-medium tracking-wide uppercase` |
| In-progress label color | `bankColor` (Borjie: `text-warning`) |
| Upcoming label opacity | `0.5` |
| Entry animation | `initial={opacity:0}` `animate={opacity:1}` `transition={duration:0.3}` |

---

## 4. Concept card (the showpiece)

Source: `core/litfin-ai/generative-ui/blocks/ConceptCard.tsx` (1032 lines).

### Outer card
- `relative rounded-2xl border border-primary/20 overflow-hidden my-3`
- shadow: `shadow-xl shadow-primary/10`
- bg: `bg-card` (dark `bg-[hsl(24,25%,11%)]`) → Borjie `bg-surface dark:bg-surface-raised`
- Header accent bar: `h-[3px] w-full bg-gradient-to-r from-primary via-primary/80 to-primary/60` → Borjie warning gradient
- Two layered gradient overlays: `bg-gradient-to-br from-primary/[0.08] via-transparent to-amber-500/[0.05]` + `bg-gradient-to-t from-black/10 via-transparent to-transparent`
- Entry: `initial={opacity:0,y:16,scale:0.97}` → `animate={opacity:1,y:0,scale:1}` `transition={type:"spring",stiffness:260,damping:24}`
- Inner pad: `p-5`

### Header row
- `flex items-start gap-3.5 mb-4`
- Icon container: `h-10 w-10 rounded-xl bg-gradient-to-br from-primary to-amber-500 flex items-center justify-center shadow-lg shadow-primary/25` → Borjie warning-to-warning/70 gradient
- Pulse ring on icon: `absolute inset-0 rounded-xl bg-primary/20` animate `scale: [1, 1.15, 1]`, opacity `[0.3, 0, 0.3]`, duration 3s repeat infinity
- Title: `text-[15px] font-bold tracking-tight truncate leading-snug text-foreground`
- Category pill: `text-[10px] px-2.5 py-0.5 rounded-full bg-primary/8 text-primary font-semibold border border-primary/10 uppercase tracking-wide`
- Bloom difficulty pill: same dimensions; color varies by index (emerald / amber / rose)
- Description: `text-[13px] text-foreground/70 leading-relaxed line-clamp-3`

### Bloom level bar
- Outer: `mb-4 p-3 rounded-xl bg-foreground/[0.04] backdrop-blur-sm border border-foreground/[0.08]`
- Label: `text-[10px] uppercase tracking-widest font-semibold`
- Active level chip: `text-[10px] font-bold px-2 py-0.5 rounded-full ring-1`
- Bar: 6 segments `flex gap-1.5 h-2`, each segment `flex-1 rounded-full origin-left`; staggered scale-in at `delay: 0.2 + i * 0.06, duration: 0.3`
- Inactive segment: `bg-foreground/[0.08]`

### Mastery progress
- Label row: `flex items-center justify-between mb-2`
- Value: `text-xs font-bold tabular-nums`
- Track: `h-2.5 bg-foreground/[0.08] rounded-full overflow-hidden border border-foreground/[0.06]`
- Fill: `h-full rounded-full bg-gradient-to-r from-primary to-amber-400` (≥80 emerald-to-green; ≥50 amber-to-yellow)
- Fill animation: `initial={width:0}` → `animate={width:"X%"}` `transition={duration:1, ease:"easeOut", delay:0.3}`
- Shimmer overlay: `bg-gradient-to-r from-transparent via-white/25 to-transparent` animate `x: ["-100%","200%"]` duration 2 repeat repeatDelay 3

### Exploration progress (per key point)
- 1.5 gap segments, `flex-1 h-2 rounded-full origin-left`
- Explored: `bg-gradient-to-r from-emerald-500 to-teal-400`
- Selected: `bg-primary/60` → Borjie `bg-warning/60`
- Unexplored: `bg-foreground/[0.08]`
- Stagger: `delay: i * 0.05, duration: 0.2`

### Key points list
- `space-y-2 mb-3`. Section label `text-[10px] text-muted-foreground/70 font-bold uppercase tracking-[0.15em]`
- Each point: `w-full flex items-start gap-3 rounded-xl px-3 py-2.5 transition-all duration-200 border`
- Unexplored: `border-foreground/[0.06] hover:border-primary/20 hover:bg-primary/[0.06] bg-foreground/[0.03]` → Borjie warning equivalents
- Selected: `border-primary/30 bg-primary/10 shadow-md shadow-primary/10 ring-1 ring-primary/15`
- Explored: `border-emerald-500/15 bg-emerald-500/[0.05] opacity-70`
- Bullet indicator: `h-5 w-5 rounded-lg flex items-center justify-center mt-0.5`. Selected: gradient with `shadow-[0_0_8px_rgba(...)]` and an inner `h-2 w-2 rounded-full` pulse animate `scale:[1,1.4,1]` duration 1.5 repeat
- Text: `text-[13px] leading-relaxed`. Explored: `line-through decoration-emerald-500/30 text-muted-foreground/60`
- Entry: `initial={opacity:0,x:-12}` `animate={opacity:1,x:0}` `transition={delay: 0.15 + i*0.07, type:"spring", stiffness:300, damping:25}`

### Action row (Deep dive + Go wider)
- Outer: `pt-3.5 mt-2 border-t border-foreground/[0.08]`
- Optional context indicator (when a point is selected): `mb-3 px-3 py-2 rounded-xl bg-primary/[0.08] border border-primary/15` with `Zap` icon and `text-[11px] text-primary font-semibold`
- Buttons: `flex gap-2.5`; each `flex-1 text-[12px] px-4 py-2.5 rounded-xl font-semibold border inline-flex items-center justify-center gap-2`
- Hover: `whileHover={{scale:1.03,y:-2}}`, `whileTap={{scale:0.97}}`, spring 400/20

### Professor attribution
- `flex items-center gap-2 mt-3 pt-2`
- Avatar: `h-6 w-6 rounded-full bg-gradient-to-br from-primary to-amber-500 shadow-sm`
- Label: `text-[10px] text-muted-foreground font-medium`

---

## 5. Message bubble

| Side | Shape | Background |
|---|---|---|
| AI (assistant) | `rounded-2xl rounded-tl-sm` | `bg-muted/60 dark:bg-white/5 text-foreground` |
| User | `rounded-2xl rounded-tr-sm` | `bg-primary/15 text-foreground ring-1 ring-primary/25` → Borjie `bg-warning/15 ring-1 ring-warning/25` |

Common: `max-w-[80%] px-4 py-2.5 text-sm leading-relaxed`.

### Row
- `relative flex gap-3`. AI: `justify-start`. User: `justify-end`.
- Avatar: `h-7 w-7 rounded-full shrink-0 mt-0.5`. AI: brand icon
  `LitfinIcon size={28}` → Borjie wordmark mark. User: gradient
  `from-slate-100 to-slate-200 dark:from-slate-700 dark:to-slate-800`
  with `User` icon `h-3.5 w-3.5`.
- Entry: `initial={opacity:0,y:8}` `animate={opacity:1,y:0}`
  `transition={duration:0.25, ease:"easeOut"}`.

### Streaming dots (no content yet)
3 dots `w-1.5 h-1.5 rounded-full bg-current opacity-40 animate-bounce`,
delays `0ms / 150ms / 300ms`.

### Streaming cursor (content present)
`inline-block w-1.5 h-4 ml-0.5 bg-primary animate-pulse rounded-sm
align-text-bottom`.

### Timestamp
`text-[10px] mt-1.5 text-muted-foreground/60`.

### Voice indicator
`flex items-center gap-1 mb-1.5 text-[10px] text-muted-foreground` plus mic emoji.

### Acknowledgment prefix
`whitespace-pre-wrap mb-2 pb-2 border-b border-border/30 italic text-muted-foreground text-xs`.

---

## 6. Typing indicator (assistant placeholder)

- `flex items-center gap-3`
- Avatar bubble: `h-7 w-7 rounded-full shrink-0`
- Pill: `flex flex-col gap-1 px-4 py-3 rounded-2xl rounded-tl-sm bg-muted/60 dark:bg-white/5`
- Text: `text-xs text-muted-foreground`
- 3 dots `w-2 h-2 rounded-full` color = bankColor, animate `scale: [1,1.2,1]`, duration 0.6 repeat, delays `0 / 0.15 / 0.3`.

---

## 7. Quick-reply chips (below the latest AI bubble)

- Container: `flex flex-wrap gap-2 pl-10` (the `pl-10` aligns the chips
  with the message body — clearing the avatar gutter)
- Entry: `initial={opacity:0,y:6}` `animate={opacity:1,y:0}`
  `transition={delay: 0.35, duration: 0.3}`
- Per-chip wrapper: `relative inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium`
- Background: `${bankColor}15`, border `1px solid ${bankColor}30` → Borjie warning
- Hover overlay: `linear-gradient(135deg, ${bankColor}12 0%, transparent 60%)` opacity 0→100 on hover
- Top shine line: `absolute inset-x-0 top-0 h-px` gradient transparent→`${bankColor}40`→transparent
- Stagger: `delay: 0.4 + i*0.06, type:"spring", stiffness:420, damping:24`
- Hover micro: `whileHover={{scale:1.03, y:-1}}`, `whileTap={{scale:0.97}}`
- Optional trailing arrow: 10x10 SVG chevron, opacity 0 + `-translate-x-1` → opacity 40 + 0 on hover
- "Or type your own" affordance: `text-[11px] text-muted-foreground/60 italic` appended

---

## 8. Empty state ("welcome")

- Outer: `flex flex-col items-center justify-center h-full text-center px-4 py-8`
- Icon: `w-14 h-14 rounded-2xl flex items-center justify-center mb-6 shadow-lg` with `bankColor` gradient bg
- Persona name: `text-sm font-medium text-foreground mb-2`
- Dot row: 3 dots `w-2 h-2 rounded-full`, animate `opacity:[0.3,1,0.3], scale:[0.8,1,0.8]` duration 1.2 repeat
- Subline: `text-xs text-muted-foreground/60 max-w-[280px]`

---

## 9. Action row inside bubble (NEW IN BORJIE — adapted)

Borjie's brain emits `suggested_actions` and `spawn_tabs` in addition
to LitFin's quick replies. Same chip pattern — match the LitFin chip
shape exactly; just multi-tone. `pl-10` left padding keeps them
aligned under the message body.

---

## 10. Token replacement table (LitFin → Borjie)

| LitFin token | Borjie token |
|---|---|
| `bg-primary/15` (copper) | `bg-warning/15` (gold) |
| `text-primary` | `text-warning` |
| `border-primary/20` | `border-warning/30` |
| `from-primary to-amber-500` | `from-warning to-warning/70` |
| `stroke-teal-400` (sidebar active) | `stroke-warning` |
| `bg-teal-500/10` (active row) | `bg-warning/10` |
| `border-teal-400` | `border-warning` |
| `hsl(220,18%,8%)` (sidebar bg dark) | tokenised via `bg-surface` (which the Borjie globals already pin to `~10%`) |
| `bg-card dark:bg-[hsl(24,25%,11%)]` (concept-card bg) | `bg-surface dark:bg-surface-raised` |
| `bg-muted/60 dark:bg-white/5` (AI bubble) | `bg-surface/70 dark:bg-white/[0.04]` |
| `text-foreground/70` | `text-foreground/70` (token survives) |

Borjie never uses `bg-card` directly because the design system pins
`surface` to the same cool-slate hue. The bilingual text strings
(Karibu only in sw, English avoids the word) are preserved.

---

## 11. Motion vocabulary (Framer Motion)

- Bubble entry: `{duration:0.25, ease:"easeOut"}`
- Concept card entry: `spring {stiffness:260, damping:24}`
- Quick-reply chip entry: `spring {stiffness:420, damping:24}` with
  `delay: 0.4 + i*0.06`
- Hover micro on chips/buttons: `spring {stiffness:400, damping:20}`
- Mastery shimmer: `x:["-100%","200%"]` 2s repeat, repeatDelay 3
- Pulse on selected bullet: `scale:[1,1.4,1]` 1.5s repeat

---

## 12. Where these visuals attach in Borjie

| LitFin file | Borjie file (new or modified) |
|---|---|
| `LearningSidebar.tsx` | `apps/owner-web/src/components/home-chat/StepperBar.tsx` (NEW — left rail with 5 mining literacy steps + mastery rings) |
| `ConceptCard.tsx` | `apps/owner-web/src/components/home-chat/ConceptCard.tsx` (NEW — replaces the placeholder concept_card in `UiBlockRenderer.tsx`) |
| `StepBracketDivider.tsx` (mastery dial logic in LearningSidebar) | `apps/owner-web/src/components/home-chat/MasteryDial.tsx` (NEW — SVG ring used inside StepperBar + concept card) |
| `UnifiedChatMessages.tsx` MessageBubble | `apps/owner-web/src/components/home-chat/MessageBubble.tsx` (NEW — replaces the inline bubble in HomeChatTeach.tsx) |
| `UnifiedChatMessages.tsx` Quick-reply chips | `apps/owner-web/src/components/home-chat/QuickReplyChips.tsx` (NEW) |
| `ConceptCard.tsx` (visual lesson card pattern) | `apps/owner-web/src/components/home-chat/MicroLessonCard.tsx` (NEW — image/illustration + body + footer CTAs for inline micro-lessons) |
| Composition root | `apps/owner-web/src/components/home-chat/HomeChatTeach.tsx` (REWRITE the chrome to use the new components) |

---

## 13. Mining literacy ladder (Borjie-specific stepper)

Five steps; matches the home teaching system prompt:

| # | Step ID | Sw label | En label |
|---|---|---|---|
| 1 | `ORIENT` | Tambua mali | Orient your estate |
| 2 | `LICENCE` | Leseni & EIA | Licence and EIA |
| 3 | `ROYALTY` | Mrabaha & Forodha | Royalty and clearance |
| 4 | `WORKFORCE` | Wafanyakazi & Mafunzo | Workforce and training |
| 5 | `MARKETPLACE` | Soko & Mauzo | Marketplace and sales |

`StepperBar` maps `lessonStep` (1..5) to one of these IDs and renders
the active row + mastery ring per step.
