import {
  ArrowUpRight,
  CheckCircle2,
  Eye,
  Compass,
  Brain,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { getMessages, type Locale } from '@/lib/i18n';

/**
 * LoopValidatorSection — OODA Loop validator-gap proof point.
 *
 * Per FOUNDER_LOCKED_DECISIONS_2026_05_26.md §2 Finding 3, the
 * IEEE Spectrum + Snyk joint paper "Agentic AI's OODA Loop Problem"
 * (2026) identifies a structural gap in agentic AI: when Observe →
 * Orient → Decide → Act loops run at machine speed without a
 * validator between Decide and Act, speed compounds errors instead
 * of value. Borjie's `@borjie/loop-quality-gates` package
 * (Wave M3-M4) is the validator the paper says is missing. The five
 * mandatory gates — groundedness, calibration, brand, authority,
 * budget — AND-combine into a single pass/fail predicate between the
 * Tools layer and any persistence/notification/action.
 *
 * Layout: two-column rationale (paper finding | Borjie response) on
 * top, OODA Loop SVG diagram below, cross-link row at the foot. The
 * diagram explicitly renders the validator as a separate stage
 * between Decide and Act so the visual mirrors the structural claim.
 */
export function LoopValidatorSection({
  locale,
}: {
  readonly locale: Locale;
}) {
  const t = getMessages(locale).loopValidator;
  const gateIcons = [Eye, Compass, Brain, ShieldCheck, Zap] as const;
  const gates = t.response.gates.map((g, i) => ({
    ...g,
    icon: gateIcons[i % gateIcons.length] ?? ShieldCheck,
  }));

  return (
    <section
      id="loop-validator"
      className="relative mx-auto max-w-7xl px-6 pb-24 pt-4 lg:px-8"
      aria-labelledby="loop-validator-heading"
    >
      <div className="mx-auto max-w-3xl text-center">
        <p className="font-mono text-xs uppercase tracking-widest text-signal-500">
          {t.kicker}
        </p>
        <h2
          id="loop-validator-heading"
          className="mt-4 font-display text-4xl font-medium tracking-tight text-balance sm:text-5xl"
        >
          {t.heading}
        </h2>
        <p className="mx-auto mt-5 max-w-[60ch] text-lg leading-relaxed text-neutral-400">
          {t.sub}
        </p>
      </div>

      <div className="mt-14 grid gap-6 lg:grid-cols-2">
        <article className="rounded-2xl border border-border bg-surface p-7">
          <p className="font-mono text-[0.62rem] uppercase tracking-widest text-neutral-400">
            {t.paper.kicker}
          </p>
          <h3 className="mt-2 font-display text-xl font-medium tracking-tight text-balance">
            {t.paper.title}
          </h3>
          <p className="mt-3 text-sm leading-relaxed text-neutral-400">
            {t.paper.finding}
          </p>
          <blockquote className="mt-5 border-l-2 border-signal-500/40 pl-4 text-sm italic leading-relaxed text-foreground">
            {t.paper.quote}
          </blockquote>
          <p className="mt-4 font-mono text-[0.62rem] uppercase tracking-widest text-neutral-500">
            {t.paper.attribution}
          </p>
          <a
            href="https://spectrum.ieee.org/agentic-ai-ooda-loop"
            target="_blank"
            rel="noreferrer"
            className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-signal-500 transition-colors duration-fast hover:text-foreground"
          >
            {t.paper.linkLabel}
            <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        </article>

        <article className="rounded-2xl border border-signal-500/30 bg-surface p-7 shadow-[0_0_48px_-24px_hsl(var(--signal-500)/0.4)]">
          <p className="font-mono text-[0.62rem] uppercase tracking-widest text-signal-500">
            {t.response.kicker}
          </p>
          <h3 className="mt-2 font-display text-xl font-medium tracking-tight text-balance">
            {t.response.title}
          </h3>
          <p className="mt-3 text-sm leading-relaxed text-neutral-400">
            {t.response.body}
          </p>
          <ul className="mt-5 space-y-3">
            {gates.map((g) => {
              const Icon = g.icon;
              return (
                <li key={g.id} className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-signal-500/25 bg-signal-500/5 text-signal-500">
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {g.name}
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-neutral-400">
                      {g.blurb}
                    </p>
                  </div>
                  <CheckCircle2
                    className="ml-auto mt-1 h-4 w-4 shrink-0 text-success"
                    aria-hidden="true"
                  />
                </li>
              );
            })}
          </ul>
        </article>
      </div>

      <figure className="mt-10 rounded-2xl border border-border bg-surface p-6 sm:p-8">
        <figcaption className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-mono text-[0.62rem] uppercase tracking-widest text-signal-500">
            {t.diagram.kicker}
          </p>
          <p className="font-mono text-[0.6rem] uppercase tracking-widest text-neutral-500">
            {t.diagram.legend}
          </p>
        </figcaption>
        <OodaLoopDiagram
          stageLabels={t.diagram.stages}
          validatorLabel={t.diagram.validatorLabel}
          gapLabel={t.diagram.gapLabel}
          closedByDesignLabel={t.diagram.closedByDesignLabel}
          flowLabel={t.diagram.flowLabel}
        />
        <p className="mt-5 text-center text-xs leading-relaxed text-neutral-400 sm:text-sm">
          {t.diagram.caption}
        </p>
      </figure>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3 text-sm">
        <a
          href="https://github.com/borjie/borjie/blob/main/Docs/DESIGN/FIVE_LAYER_LOOP_ARCHITECTURE_SPEC.md"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-signal-500/30 bg-signal-500/5 px-4 py-2 font-medium text-signal-500 transition-colors duration-fast hover:bg-signal-500/10 hover:text-foreground"
        >
          {t.links.spec}
          <ArrowUpRight className="h-3.5 w-3.5" />
        </a>
        <a
          href="https://snyk.io/blog/agentic-ooda-loop/"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-4 py-2 font-medium text-neutral-400 transition-colors duration-fast hover:border-signal-500/30 hover:text-foreground"
        >
          {t.links.snyk}
          <ArrowUpRight className="h-3.5 w-3.5" />
        </a>
        <a
          href="https://spectrum.ieee.org/agentic-ai-ooda-loop"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-4 py-2 font-medium text-neutral-400 transition-colors duration-fast hover:border-signal-500/30 hover:text-foreground"
        >
          {t.links.ieee}
          <ArrowUpRight className="h-3.5 w-3.5" />
        </a>
      </div>
    </section>
  );
}

interface OodaLoopDiagramProps {
  readonly stageLabels: readonly string[];
  readonly validatorLabel: string;
  readonly gapLabel: string;
  readonly closedByDesignLabel: string;
  readonly flowLabel: string;
}

/**
 * OodaLoopDiagram — inline SVG of the OODA loop with the validator
 * gate rendered as a distinct stage between Decide and Act. Brand
 * tokens only (currentColor for foreground, signal-500 for accent,
 * success for the validator pass) — no hex literals. Decorative
 * `aria-hidden` on the SVG, with a textual `<figcaption>` carrying
 * the meaning for screen readers (see parent component).
 *
 * Mobile sticks to a vertical flow via the viewBox aspect ratio; on
 * larger screens the SVG simply scales — no separate layout path.
 */
function OodaLoopDiagram({
  stageLabels,
  validatorLabel,
  gapLabel,
  closedByDesignLabel,
  flowLabel,
}: OodaLoopDiagramProps) {
  const observe = stageLabels[0] ?? 'Observe';
  const orient = stageLabels[1] ?? 'Orient';
  const decide = stageLabels[2] ?? 'Decide';
  const act = stageLabels[3] ?? 'Act';

  const mobileStages = [
    { n: '01', label: observe, validator: false },
    { n: '02', label: orient, validator: false },
    { n: '03', label: decide, validator: false },
    { n: '04', label: validatorLabel, validator: true },
    { n: '05', label: act, validator: false },
  ];

  return (
    <div className="relative w-full">
      <span className="sr-only">{flowLabel}</span>

      {/* Mobile — vertical stack, full-readable labels */}
      <ol className="flex flex-col gap-3 sm:hidden" aria-hidden="true">
        {mobileStages.map((s) => (
          <li
            key={s.n}
            className={
              s.validator
                ? 'rounded-xl border border-signal-500/40 bg-signal-500/5 px-4 py-3 shadow-[0_0_24px_-12px_hsl(var(--signal-500)/0.4)]'
                : 'rounded-xl border border-border bg-background px-4 py-3'
            }
          >
            <div className="flex items-baseline justify-between gap-2">
              <span
                className={
                  s.validator
                    ? 'font-mono text-[0.6rem] uppercase tracking-widest text-signal-500'
                    : 'font-mono text-[0.6rem] uppercase tracking-widest text-neutral-500'
                }
              >
                {s.n}
                {s.validator ? ' · GATE' : ''}
              </span>
              {s.validator ? (
                <span className="font-mono text-[0.6rem] uppercase tracking-widest text-signal-500">
                  {closedByDesignLabel}
                </span>
              ) : null}
            </div>
            <p
              className={
                s.validator
                  ? 'mt-1 font-display text-base font-semibold tracking-tight text-foreground'
                  : 'mt-1 font-display text-base font-medium tracking-tight text-foreground'
              }
            >
              {s.label}
            </p>
          </li>
        ))}
      </ol>

      {/* Desktop / tablet — horizontal SVG ribbon with validator gate */}
      <svg
        viewBox="0 0 880 280"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-hidden="true"
        className="hidden h-auto w-full sm:block"
      >
        <defs>
          <marker
            id="loop-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="oklch(0.78 0.16 75)" />
          </marker>
          <marker
            id="loop-arrow-muted"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="oklch(0.30 0.02 80)" />
          </marker>
        </defs>

        {/* Stage 1 — Observe */}
        <g>
          <rect
            x="20"
            y="100"
            width="140"
            height="80"
            rx="14"
            fill="oklch(0.22 0.02 80)"
            stroke="oklch(0.30 0.02 80)"
            strokeWidth="1"
          />
          <text
            x="90"
            y="135"
            textAnchor="middle"
            fontFamily="JetBrains Mono, monospace"
            fontSize="11"
            fill="oklch(0.78 0.16 75)"
            letterSpacing="2"
          >
            01
          </text>
          <text
            x="90"
            y="158"
            textAnchor="middle"
            fontFamily="Plus Jakarta Sans, Inter, sans-serif"
            fontSize="16"
            fontWeight="500"
            fill="oklch(0.95 0.01 80)"
          >
            {observe}
          </text>
        </g>

        {/* Arrow Observe -> Orient */}
        <line
          x1="166"
          y1="140"
          x2="194"
          y2="140"
          stroke="oklch(0.78 0.16 75)"
          strokeWidth="1.5"
          markerEnd="url(#loop-arrow)"
        />

        {/* Stage 2 — Orient */}
        <g>
          <rect
            x="200"
            y="100"
            width="140"
            height="80"
            rx="14"
            fill="oklch(0.22 0.02 80)"
            stroke="oklch(0.30 0.02 80)"
            strokeWidth="1"
          />
          <text
            x="270"
            y="135"
            textAnchor="middle"
            fontFamily="JetBrains Mono, monospace"
            fontSize="11"
            fill="oklch(0.78 0.16 75)"
            letterSpacing="2"
          >
            02
          </text>
          <text
            x="270"
            y="158"
            textAnchor="middle"
            fontFamily="Plus Jakarta Sans, Inter, sans-serif"
            fontSize="16"
            fontWeight="500"
            fill="oklch(0.95 0.01 80)"
          >
            {orient}
          </text>
        </g>

        {/* Arrow Orient -> Decide */}
        <line
          x1="346"
          y1="140"
          x2="374"
          y2="140"
          stroke="oklch(0.78 0.16 75)"
          strokeWidth="1.5"
          markerEnd="url(#loop-arrow)"
        />

        {/* Stage 3 — Decide */}
        <g>
          <rect
            x="380"
            y="100"
            width="140"
            height="80"
            rx="14"
            fill="oklch(0.22 0.02 80)"
            stroke="oklch(0.30 0.02 80)"
            strokeWidth="1"
          />
          <text
            x="450"
            y="135"
            textAnchor="middle"
            fontFamily="JetBrains Mono, monospace"
            fontSize="11"
            fill="oklch(0.78 0.16 75)"
            letterSpacing="2"
          >
            03
          </text>
          <text
            x="450"
            y="158"
            textAnchor="middle"
            fontFamily="Plus Jakarta Sans, Inter, sans-serif"
            fontSize="16"
            fontWeight="500"
            fill="oklch(0.95 0.01 80)"
          >
            {decide}
          </text>
        </g>

        {/* Arrow Decide -> Validator gate */}
        <line
          x1="526"
          y1="140"
          x2="554"
          y2="140"
          stroke="oklch(0.78 0.16 75)"
          strokeWidth="1.5"
          markerEnd="url(#loop-arrow)"
        />

        {/* Validator gate — highlighted */}
        <g>
          <rect
            x="560"
            y="92"
            width="160"
            height="96"
            rx="14"
            fill="oklch(0.18 0.02 80)"
            stroke="oklch(0.58 0.12 65)"
            strokeWidth="1.5"
          />
          <rect
            x="560"
            y="92"
            width="160"
            height="96"
            rx="14"
            fill="oklch(0.58 0.12 65)"
            fillOpacity="0.08"
          />
          <text
            x="640"
            y="123"
            textAnchor="middle"
            fontFamily="JetBrains Mono, monospace"
            fontSize="11"
            fill="oklch(0.78 0.16 75)"
            letterSpacing="2"
          >
            04 · GATE
          </text>
          <text
            x="640"
            y="148"
            textAnchor="middle"
            fontFamily="Plus Jakarta Sans, Inter, sans-serif"
            fontSize="16"
            fontWeight="600"
            fill="oklch(0.95 0.01 80)"
          >
            {validatorLabel}
          </text>
          <text
            x="640"
            y="170"
            textAnchor="middle"
            fontFamily="JetBrains Mono, monospace"
            fontSize="10"
            fill="oklch(0.78 0.16 75)"
            letterSpacing="1.5"
          >
            {closedByDesignLabel}
          </text>
        </g>

        {/* Arrow Validator -> Act */}
        <line
          x1="726"
          y1="140"
          x2="754"
          y2="140"
          stroke="oklch(0.78 0.16 75)"
          strokeWidth="1.5"
          markerEnd="url(#loop-arrow)"
        />

        {/* Stage 5 — Act */}
        <g>
          <rect
            x="760"
            y="100"
            width="100"
            height="80"
            rx="14"
            fill="oklch(0.22 0.02 80)"
            stroke="oklch(0.30 0.02 80)"
            strokeWidth="1"
          />
          <text
            x="810"
            y="135"
            textAnchor="middle"
            fontFamily="JetBrains Mono, monospace"
            fontSize="11"
            fill="oklch(0.78 0.16 75)"
            letterSpacing="2"
          >
            05
          </text>
          <text
            x="810"
            y="158"
            textAnchor="middle"
            fontFamily="Plus Jakarta Sans, Inter, sans-serif"
            fontSize="16"
            fontWeight="500"
            fill="oklch(0.95 0.01 80)"
          >
            {act}
          </text>
        </g>

        {/* Feedback arc Act -> Observe (closes the loop) */}
        <path
          d="M810,180 Q810,250 440,250 Q90,250 90,180"
          stroke="oklch(0.30 0.02 80)"
          strokeWidth="1.2"
          strokeDasharray="4 4"
          fill="none"
          markerEnd="url(#loop-arrow-muted)"
        />
        <text
          x="450"
          y="270"
          textAnchor="middle"
          fontFamily="JetBrains Mono, monospace"
          fontSize="10"
          fill="oklch(0.60 0.02 80)"
          letterSpacing="1.5"
        >
          {flowLabel}
        </text>

        {/* Gap callout — what IEEE+Snyk identified */}
        <text
          x="540"
          y="60"
          textAnchor="end"
          fontFamily="JetBrains Mono, monospace"
          fontSize="10"
          fill="oklch(0.60 0.02 80)"
          letterSpacing="1.5"
        >
          {gapLabel}
        </text>
        <line
          x1="544"
          y1="64"
          x2="640"
          y2="88"
          stroke="oklch(0.30 0.02 80)"
          strokeWidth="0.8"
          strokeDasharray="2 3"
        />
      </svg>
    </div>
  );
}
