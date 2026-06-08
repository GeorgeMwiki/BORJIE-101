# Design-System Unification — INV-K Dossier

**Lane:** design-system-unification (audit + light web SOTA)
**Mandate:** INV-K — one unified design language to Chrome-level polish; the
*same* styling all the way to artifacts/docs/media. Every render
(chat / tabs / lenses / SVG-diagrams / HTML-widgets / charts / documents /
media) must inherit ONE Borjie design language end-to-end, through OUR
design tokens.
**Author:** parity-final audit pass, 2026-06-08
**Status legend:** PRESENT (wired + correct) · PARTIAL (exists but diverges or
leaks) · ABSENT (no wiring / foreign default reaches the user)

---

## 0. TL;DR — the verdict

The **app chrome** (owner-web, admin-web, marketing — buttons, cards, nav,
tabs, forms) is **PRESENT and strong**: a real copper-on-cream HSL token
system in `packages/design-system`, consumed correctly by every web app via a
Tailwind preset + a shared `globals.css` cascade, with light/dark, motion,
a11y focus rings, and a `borjie/no-non-token-style` ESLint rule already
written.

The **generated surfaces** — the things Mr. Mwikila actually *produces*
(genui tabs, in-chat rich blocks, inline artifacts, documents, slide decks,
media) — are **the failure zone**. There is **no single token source**. I
found **five divergent palettes** and **four parallel render stacks** that do
NOT share the design system. The result: a button in the cockpit is copper;
the chart inside the tab it spawned is slate-blue; the PDF it exports is Office
navy-and-gold Calibri; the in-chat royalty calculator is hardcoded
`#0f172a`/`#3b82f6`; the document "brand-lock" validates against a *stale
sky-blue* palette that the live design system abandoned. A generated artifact
today looks **foreign / Claude.ai-default**, not Borjie.

This is squarely an INV-K violation. It is fixable with one mechanical move:
**collapse every palette to one machine-generated token source and pipe it into
every render target** (Tailwind, CSS vars, Vega/ECharts theme, OOXML branders,
media brand-spec). The enforcement rule already exists — it just needs to be
escalated from `warning` to `error` and pointed at the leaking files.

---

## 1. What exists in `packages/design-system` (the good core)

**PRESENT.** The canonical system is real and well-built.

| Layer | File | State |
|---|---|---|
| Color (light + dark) | `packages/design-system/src/styles/globals.css` | PRESENT — 11-step neutral ramp + 11-step copper "signal" ramp + semantic (success/warning/danger/info) + `--litfin-*` named hooks, all HSL `var()` so `.dark` flips automatically |
| Tailwind binding | `packages/design-system/tailwind.config.ts` | PRESENT — every token surfaced as a utility (`bg-signal-500`, `text-foreground`, `border-border`, `shadow-glow`, radii, motion ease/duration, keyframes) |
| Typography | `globals.css` `--font-display/-sans/-mono` | PARTIAL — declares **Syne / Inter / JetBrains Mono**; see §3 font drift |
| Radius / shadow / motion | `globals.css` + tailwind | PRESENT — pinned radius scale, one-light-source warm shadows, copper glow, 4 ease curves + durations, reduced-motion guard |
| Components | `packages/design-system/src/components/*` (~45 + stories) | PRESENT — Button/Card/Table/Dialog/Drawer/Tabs/DataGrid/Toast/etc., Radix-backed, all token-driven |
| Brand assets | `src/brand/*` (wordmark, mark, lockups, favicons, OG) | PRESENT |
| Theme runtime | `src/theme/*` (`ThemeProvider`, `ThemeToggle`, `useColorScheme`, bootstrap script) | PRESENT |

**App consumption — PRESENT and correct:**
- `apps/owner-web/tailwind.config.ts`, `apps/admin-web/tailwind.config.ts`,
  `apps/marketing/tailwind.config.ts` all `import baseConfig from
  '@borjie/design-system/tailwind.config'` and spread its `theme.extend`.
- `apps/owner-web/src/app/globals.css` (and admin-web's) `@import` the
  design-system `globals.css`, inheriting every CSS var. owner-web's own
  `@layer components` styles app-shell hooks with `@apply ... bg-surface
  border-border text-foreground` — tokens only, no hex. **This is the model
  the rest of the platform should follow.**

**The one structural defect in the core:** there are **two contradictory token
files inside the design system itself**:
- `packages/design-system/lib/tokens.ts` — exports `colors.brand` = **sky
  blue** `#0ea5e9`, neutral cool-slate, **no dark mode, no copper**. This is the
  pre-pivot palette. It is still exported and still imported by downstream code
  (see §4).
- `packages/design-system/src/styles/globals.css` — the **live copper-on-cream**
  HSL system.

These disagree on the single most important fact about the brand (what color
"brand" is). Every consumer that reads `lib/tokens.ts` instead of the CSS vars
inherits the dead sky-blue identity. This is the root of the whole problem.

---

## 2. The generated-surface render stacks (the failure zone)

There is **no one renderer**. Four independent stacks emit "Mwikila output,"
and they do not share styling:

| # | Stack | Entry file | Tokens? |
|---|---|---|---|
| A | `@borjie/genui` AG-UI primitives (35 kinds: charts, tables, KPIs, kanban, timelines…) | `packages/genui/src/AdaptiveRenderer.tsx` → `components/*` | PARTIAL |
| B | Portal-genui tabs (14 widget kinds) | `packages/portal-genui` → `apps/owner-web/src/components/genui-tab/GenUIWidgetRenderer.tsx` | PRESENT (tokens) |
| C | In-chat rich blocks (royalty calculator, risk wheel, comparison table, flow diagrams, quiz, insight cards…) | `packages/chat-ui/src/generative-ui/AdaptiveRenderer.tsx` → `blocks/*` | ABSENT (hardcoded hex) |
| D | Documents / decks / media (PDF, DOCX, PPTX, XLSX, images, video) | `packages/document-studio`, `packages/document-templates/brand-lock`, `packages/report-engine`, `packages/media-generation/brand-lock` | PARTIAL — stale or foreign palette |

Plus a server-side fifth chrome for HTML artifacts:
`services/api-gateway/src/services/artifact-richness/branded-layout.ts`
(`ARTIFACT_RICHNESS_CSS`) mirrored by
`apps/owner-web/src/components/artifacts/artifact-renderer.css`.

**Critically: `packages/genui` (stack A) does NOT depend on
`@borjie/design-system` at all.** It uses bare Tailwind utility *names*
(`bg-surface`, `text-muted-foreground`, `border-border`) and *relies on the
host app's Tailwind build* to give those classes the copper values. That works
**only inside owner-web/admin-web** where the preset is present. The moment a
genui primitive is rendered anywhere without the design-system preset compiled
in (a standalone embed, an email, a server-rendered artifact, a new surface),
its classes resolve to **stock Tailwind blue/slate** — foreign by default.
There is no `@borjie/design-system` import to guarantee otherwise.

---

## 3. The five divergent palettes (proof of fragmentation)

Each "brand" definition disagrees with the others. This is the core INV-K
breach.

1. **Live app palette (canonical):** copper `hsl(24 58% 48%)` ≈ `#C45B12`
   family, warm cream `hsl(40 40% 98%)`, Syne/Inter — `globals.css`.
2. **Legacy design-system tokens:** sky-blue `#0ea5e9`, cool slate, Inter only,
   no dark — `packages/design-system/lib/tokens.ts`.
3. **Document brand-lock palette:** `BRAND_COLOR_PALETTE` in
   `packages/document-templates/src/brand-lock/index.ts` is the **sky→ocean
   ramp** (`#0ea5e9`…`#082f49`) + a stray `#1F3864` navy and `#C45B12` copper,
   and `BRAND_FONT_FAMILIES` whitelists **Inter/Calibri/Arial/Times** — i.e. it
   blesses Office defaults and the *dead* sky-blue, and never references the
   real copper ramp or Syne. Every DOCX/PPTX/XLSX is validated against this.
4. **Report-engine defaults:** `packages/report-engine/src/renderers/pptx.ts`
   and `docx.ts` default to `#1F3864` (navy) + `#FFC000` (gold) + **Calibri**;
   `pdf.ts` uses **Helvetica**. These are PowerPoint/Word factory defaults —
   the most "foreign" output in the whole product.
5. **Artifact-richness + media brand-spec:**
   `branded-layout.ts` / `artifact-renderer.css` use yet another set —
   `#0B0D12` ink, `#C8A24B` gold, `#ECE7D6` border, `#B33A2A` red;
   `packages/media-generation/src/brand-lock/brand-spec.ts` anchors on
   `#f59e0b` amber + `#1F3864` + `#C45B12` with **Geist**. None of these are the
   design-system tokens.

Five sources, five different answers to "what color is Borjie." A user who
spawns a tab, exports it to PDF, and asks for a slide deck sees **three
different brand identities in one session.**

**Font drift (PARTIAL):** `globals.css` *declares* `--font-display: Syne` and
*its own header comment* says the apps load Syne + Inter — but **both
`apps/owner-web/src/app/globals.css` and `apps/admin-web/src/app/globals.css`
actually `@import` Fraunces + Geist** from Google Fonts, never Syne, never
Inter. So the display font that renders is the *fallback*, not the intended
brand face. The doc/media stacks meanwhile use Inter/Geist/Calibri. No surface
agrees on the typeface.

---

## 4. Worst styling inconsistencies (ranked, with file evidence)

1. **In-chat rich blocks are hardcoded foreign hex (stack C) — ABSENT.**
   `packages/chat-ui/src/generative-ui/blocks/*` (royalty-affordability
   calculator, 5Ps risk wheel, asset comparison table, offtake/maintenance flow
   diagrams) contain **~50 hardcoded slate/blue literals** (`#0f172a` ×9,
   `#475569` ×9, `#e2e8f0` ×10, `#3b82f6` ×4, `#64748b`, `#dc2626`…). These are
   the richest, most-seen Mwikila visuals and they are pure stock-slate —
   immune to dark mode and to the copper identity entirely.

2. **`UiArtifact` references `--genui-fg` CSS vars that NOBODY defines —
   PARTIAL→ABSENT.** `packages/genui/src/UiArtifact.tsx` titles/descriptions use
   `color: 'var(--genui-fg, #0f172a)'` and `var(--genui-fg-muted, #64748b)`.
   A repo-wide grep shows **no file ever sets `--genui-fg*`**, so the fallback
   always wins → every inline artifact heading is slate `#0f172a`, never
   `--foreground`. Inline `style={{fontSize:14,…}}` here also dodges the token
   system (the `borjie/no-non-token-style` rule already flags it as a warning —
   see turbo-lint log).

3. **Generated documents are Microsoft-Office default themed — PARTIAL.**
   `packages/report-engine/src/renderers/pptx.ts` (`#1F3864`/`#FFC000`/Calibri),
   `docx.ts` (`#1F3864` headings), `pdf.ts` (Helvetica). A board deck or royalty
   statement Mwikila produces looks like a blank PowerPoint template, not a
   Borjie artifact.

4. **The document "brand-lock" enforces a STALE palette — PARTIAL.**
   `packages/document-templates/src/brand-lock/index.ts` `BRAND_COLOR_PALETTE`
   is the sky-blue/ocean ramp + Office fonts. The guardrail meant to *prevent*
   off-brand documents actively *blesses* the abandoned identity and rejects the
   real copper tokens. The lint passes, the brand is wrong.

5. **`@borjie/genui` charts/maps/trees carry hardcoded data-viz palettes —
   PARTIAL.** `VegaChart.tsx` hands a spec to Vega with **no Borjie theme/config
   injected** (default Vega category10 blues). `Heatmap.tsx`, `Tree.tsx`,
   `OrgChart.tsx`, `GanttChart.tsx`, `MapView` carry literal hex
   (`#3b82f6`, `#10b981`, `#1f6feb`…). Charts are the highest-information render
   and the most off-brand.

6. **Five brand sources / four render stacks with no shared dependency —
   PARTIAL (architectural).** `packages/genui` has zero `@borjie/design-system`
   import; `chat-ui/generative-ui` is a third AdaptiveRenderer; `report-engine`,
   `document-templates/brand-lock`, `artifact-richness`, and
   `media-generation/brand-lock` each hold their own palette. Nothing forces
   them to agree.

7. **Font identity unresolved across the board — PARTIAL.** Display font
   declared Syne but loaded Fraunces; docs use Calibri/Helvetica; media uses
   Geist. (§3.)

8. **Two contradictory token files inside the design system — PARTIAL (root
   cause).** `lib/tokens.ts` (sky blue, no dark) vs `globals.css` (copper, dark).
   Any consumer importing the TS tokens inherits the dead brand.

---

## 5. SOTA reference (light web scan)

The 2026 state of the art for "brand-theming arbitrary generative UI &
artifacts" converges on one pattern: **one machine-generated token source →
many targets → component code stays theme-agnostic → runtime context injection
for brand/dark/a11y.**

- **One source, many outputs (Style Dictionary / W3C DTCG).** Define tokens
  once in JSON; transform to CSS custom properties, Tailwind theme, JS/TS
  consts, Swift/Android/Flutter, *and* document/chart configs in CI on every
  token commit. ([Style Dictionary workflow](https://www.alwaystwisted.com/articles/a-design-tokens-workflow-part-1),
  [Figma→code pipeline](https://medium.com/@mailtorahul2485/building-a-scalable-design-token-system-from-figma-to-code-with-style-dictionary-e2c9eacc75aa),
  [What are design tokens, 2026](https://www.uxpin.com/studio/blog/what-are-design-tokens/))
- **Three-tier taxonomy** (global primitives → semantic mappings → component
  tokens) is what makes dark mode and high-contrast a *token-set swap*, never a
  component rewrite. ([color tokens light/dark](https://medium.com/design-bootcamp/color-tokens-guide-to-light-and-dark-modes-in-design-systems-146ab33023ac),
  [advanced theming](https://david-supik.medium.com/advanced-theming-techniques-with-design-tokens-bd147fe7236e))
- **Tailwind v4 `@theme`** makes the *same* CSS variables drive utilities *and*
  third-party/generated markup — "designers, app code, and third-party styles
  all speak the same language." ([Tailwind theme vars](https://tailwindcss.com/docs/theme),
  [TW4 @theme](https://medium.com/@sureshdotariya/tailwind-css-4-theme-the-future-of-design-tokens-at-2025-guide-48305a26af06))
- **Charts are themable from tokens.** Vega ships a **config object** (colors,
  typefaces, line widths) and `vega-themes`; ECharts/echarts-for-react take a
  custom theme object. Generate these from the token source so charts inherit
  the brand. ([Vega config](https://vega.github.io/vega/docs/config/),
  [vega-themes](https://www.npmjs.com/package/vega-themes),
  [ECharts themes](https://echartsforreact.com/docs/guides/themes/))
- **SVG/LLM-generated vector inherits brand via `currentColor` + CSS vars**, so
  diagrams flip with theme; AI SVG libraries are explicitly fed a design-system
  spec to stay on-brand. ([SVG theming/dark mode](https://www.svgai.org/blog/svg-theming-systems),
  [SVG in the LLM era](https://www.svg2img.cc/blog/svg-llm-importance))
- **A11y is a token responsibility:** contrast pairs and high-contrast variants
  live in the token set and are CI-checked to WCAG. ([dark-mode/theming guide](https://ngendevtech.com/blog/dark-mode-and-theme-customization-technical-implementation-guide/))

Borjie already has the *hard* part (a real semantic HSL token set + Tailwind
binding + a lint rule). What it lacks is the **single source of truth** and the
**transform pipeline** that pushes those tokens into the four generated-surface
stacks. That is exactly the SOTA gap, and it is mechanical to close.

---

## 6. The unification plan (INV-K → Chrome-level, one platform)

**Principle:** ONE token source → generated into every target → every render
stack imports the *same* tokens → component code is theme-agnostic → brand +
dark + a11y are a context swap, never a hardcode.

### Phase 1 — Collapse to one source of truth
- Promote a single token file (W3C DTCG JSON, or treat `globals.css`'s HSL vars
  as canonical) as the **only** brand definition. **Delete the sky-blue
  `lib/tokens.ts`** (or regenerate it from the copper source) so no consumer can
  import the dead palette.
- Add a **Style-Dictionary build** in `packages/design-system` that emits, on
  every token change: (a) `globals.css` custom props, (b) the Tailwind theme,
  (c) a `tokens.ts`/`tokens.json` for JS consumers, (d) a **Vega/ECharts theme
  config**, (e) an **OOXML brand palette** (hex list + font for DOCX/PPTX/XLSX),
  (f) the **media brand-spec** anchors. One commit, all targets.

### Phase 2 — Resolve typography once
- Pick the canonical display face (Syne per the design-system intent) and load
  it via `next/font` in *all* web apps; fix the `@import Fraunces/Geist` drift
  in owner-web + admin-web `globals.css`. Add the same family list to the OOXML
  brander and media brand-spec (embed/subset Syne+Inter for documents).

### Phase 3 — Make every render stack inherit the tokens
- **Stack A (`@borjie/genui`):** add `@borjie/design-system` as a real
  dependency; fix `UiArtifact.tsx` to use `text-foreground`/`text-muted-
  foreground` (and *define* `--genui-fg*` = the tokens if the var indirection is
  kept). Inject a **Borjie Vega config** + ECharts theme into `VegaChart` and
  the chart/map/tree primitives so data-viz uses the copper/neutral ramp. Ship
  the design-system CSS *with* the genui bundle so its classes resolve to copper
  even on surfaces without the host preset.
- **Stack C (`chat-ui/generative-ui/blocks`):** replace all ~50 hardcoded hex
  with token classes/`var(--…)`. These are SVG-heavy — use `currentColor` +
  `hsl(var(--signal-500))` so they flip with dark mode.
- **Stack D (documents/media):** retire `report-engine`'s `#1F3864`/`#FFC000`/
  Calibri defaults; route ALL doc rendering through the
  `document-templates/brand-lock` path **after** updating
  `BRAND_COLOR_PALETTE`/`BRAND_FONT_FAMILIES` to the copper ramp + Syne/Inter
  (generated in Phase 1). Unify `artifact-richness/branded-layout.ts` +
  `artifact-renderer.css` + `media brand-spec` onto the same generated palette.
- **Stack B (portal-genui tabs):** already token-correct — keep as the
  reference implementation.

### Phase 4 — Enforce by construction (no regression)
- Escalate the existing **`borjie/no-non-token-style`** ESLint rule from
  `warning` to **`error`** and extend its glob to `packages/genui`,
  `packages/chat-ui/generative-ui`, and the doc/media renderers (raw hex / rgb /
  hsl-literal / arbitrary `[..]` Tailwind = build failure).
- Keep `brand-validator.ts`/`lintBrand` but point it at the *generated* palette,
  and run it in CI on every produced artifact (it already exists; it's just
  validating the wrong palette).
- Add a CI **contrast gate** (WCAG 2.2 AA) over the token pairs and over a
  golden set of generated artifacts (chart, doc, deck, in-chat block) rendered
  in light + dark.

### Phase 5 — Amplify to Chrome-level (style / flow / intelligence)
- **Style:** a single `<BrandThemeProvider>` (extend the existing
  `ai-copilot/branding/tenant-branding` store) sets the CSS-var scope once per
  surface; per-tenant white-label becomes a token override layered on the
  primitives — no component touches. Add brand-aware Vega/ECharts theme,
  copper-tinted chart sequences, and `currentColor` SVG so EVERY diagram is
  on-brand and dark-mode-correct.
- **Flow:** one render entry per modality (collapse the 3 AdaptiveRenderers to a
  shared dispatcher + shared `Frame` chrome) so chat blocks, tabs, artifacts and
  exports share the same header/footer/classification chrome and motion tokens —
  a tab→PDF→deck round-trip stays visually identical.
- **Intelligence:** because tokens are semantic, the brain can request
  *intent* ("danger", "signal", "muted") instead of color; the token layer
  resolves to the right copper/emerald/slate in the active theme, guaranteeing
  on-brand output even for never-seen generated layouts.

**Definition of done (INV-K):** spawn a tab, open an artifact, export a PDF,
generate a deck, and read an in-chat calculator — all five render in the *same*
copper-on-cream (or its dark inverse) with the same display face, the same
radii/shadows/motion, and pass the WCAG gate. No foreign slate, no Office navy,
no Claude.ai-default anywhere.

---

## 7. Status matrix

| Surface | Stack | Status | Evidence |
|---|---|---|---|
| Web app chrome (owner/admin/marketing) | preset + globals | **PRESENT** | tailwind.config preset import; globals `@import`; `@apply` token classes |
| Design-system tokens (color/dark/radius/shadow/motion) | core | **PRESENT** | `src/styles/globals.css`, `tailwind.config.ts` |
| Design-system TS tokens | core | **PARTIAL** | `lib/tokens.ts` = stale sky-blue, no dark |
| Typography (Syne/Inter intent) | core + apps | **PARTIAL** | apps load Fraunces/Geist, not Syne/Inter |
| Portal-genui tabs (stack B) | portal-genui | **PRESENT** | `GenUIWidgetRenderer.tsx` token classes |
| Genui AG-UI primitives (stack A) | `@borjie/genui` | **PARTIAL** | token class *names* but no design-system dep; charts/maps hardcoded |
| `UiArtifact` inline headings | genui | **PARTIAL→ABSENT** | `--genui-fg` never defined → `#0f172a` fallback |
| In-chat rich blocks (stack C) | chat-ui generative-ui | **ABSENT** | ~50 hardcoded slate/blue hex |
| Chat markdown | chat-ui | **PARTIAL** | hand-rolled HTML; styling depends on host CSS |
| Documents PDF/DOCX/PPTX (stack D) | report-engine | **PARTIAL** | `#1F3864`/`#FFC000`/Calibri/Helvetica defaults |
| Document brand-lock | document-templates | **PARTIAL** | stale sky-blue palette + Office fonts |
| Artifact-richness HTML chrome | api-gateway | **PARTIAL** | `#0B0D12`/`#C8A24B` — own palette |
| Media brand-spec | media-generation | **PARTIAL** | `#f59e0b`/`#1F3864`/Geist anchors |
| Brand enforcement rule | eslint | **PARTIAL** | `borjie/no-non-token-style` exists but `warning`, narrow glob |

---

## 8. Sources

- [A Design Tokens Workflow — Style Dictionary](https://www.alwaystwisted.com/articles/a-design-tokens-workflow-part-1)
- [Light/Dark with Style Dictionary](https://www.alwaystwisted.com/articles/a-design-tokens-workflow-part-7)
- [Figma → code with Style Dictionary](https://medium.com/@mailtorahul2485/building-a-scalable-design-token-system-from-figma-to-code-with-style-dictionary-e2c9eacc75aa)
- [What Are Design Tokens? (2026)](https://www.uxpin.com/studio/blog/what-are-design-tokens/)
- [Managing Global Styles in React with Design Tokens](https://www.uxpin.com/studio/blog/managing-global-styles-in-react-with-design-tokens/)
- [Color tokens: light & dark modes](https://medium.com/design-bootcamp/color-tokens-guide-to-light-and-dark-modes-in-design-systems-146ab33023ac)
- [Advanced Theming with Design Tokens](https://david-supik.medium.com/advanced-theming-techniques-with-design-tokens-bd147fe7236e)
- [Tailwind CSS — Theme variables](https://tailwindcss.com/docs/theme)
- [Tailwind v4 @theme guide](https://medium.com/@sureshdotariya/tailwind-css-4-theme-the-future-of-design-tokens-at-2025-guide-48305a26af06)
- [Vega config object](https://vega.github.io/vega/docs/config/) · [vega-themes](https://www.npmjs.com/package/vega-themes) · [ECharts themes](https://echartsforreact.com/docs/guides/themes/)
- [SVG Theming Systems / dark mode](https://www.svgai.org/blog/svg-theming-systems) · [SVG in the LLM era](https://www.svg2img.cc/blog/svg-llm-importance)
- [Dark Mode & Theme Customization guide](https://ngendevtech.com/blog/dark-mode-and-theme-customization-technical-implementation-guide/)
- [Developer's guide to design tokens & CSS variables](https://penpot.app/blog/the-developers-guide-to-design-tokens-and-css-variables/)
