'use client';

import { useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2,
  FileText,
  Hammer,
  PieChart,
  Settings,
  ShieldAlert,
  Target,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { getMessages, type Locale } from '@/lib/i18n';

/**
 * MwikilaModesSection — Borjie's equivalent of LitFin's AIOfficerTabs.
 *
 * Seven tabs across the top: Build · Strategy · Operations · Document
 * · Finance · Risk · Compliance. Click a tab to swap the demo panel
 * underneath. Each mode shows a headline + capability list with gold
 * check-circles.
 *
 * The active tab is the gold-filled chip; inactive tabs are border-
 * only. Tab content uses framer-motion fade/slide that collapses to
 * instant under prefers-reduced-motion.
 */
const MODE_ICONS: Record<string, LucideIcon> = {
  build: Hammer,
  strategy: Target,
  operations: Settings,
  document: FileText,
  finance: Wallet,
  risk: ShieldAlert,
  compliance: PieChart,
};

export function MwikilaModesSection({
  locale,
}: {
  readonly locale: Locale;
}) {
  const t = getMessages(locale).home.mwikilaModes;
  const [activeId, setActiveId] = useState<string>(t.modes[0]?.id ?? 'build');

  const handleTabChange = useCallback((id: string) => {
    setActiveId(id);
  }, []);

  const active = t.modes.find((m) => m.id === activeId) ?? t.modes[0];
  if (!active) return null;

  const ActiveIcon = MODE_ICONS[active.id] ?? Hammer;

  return (
    <section
      aria-labelledby="mwikila-modes-heading"
      className="bg-background py-16 md:py-24"
    >
      <div className="mx-auto max-w-7xl px-5">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.4 }}
          className="mx-auto mb-10 max-w-3xl text-center"
        >
          <span className="font-mono text-meta uppercase tracking-widest text-signal-500">
            {t.kicker}
          </span>
          <h2
            id="mwikila-modes-heading"
            className="mt-3 font-display text-4xl font-medium tracking-tighter text-foreground md:text-5xl"
          >
            {t.title}{' '}
            <span className="text-signal-500">{t.titleAccent}</span>
          </h2>
          <p className="mx-auto mt-5 max-w-prose-wide text-lg text-neutral-400">
            {t.sub}
          </p>
        </motion.div>

        {/* Tab selectors */}
        <div
          role="tablist"
          aria-label="Mr. Mwikila modes"
          className="mb-8 flex flex-wrap justify-center gap-2"
        >
          {t.modes.map((mode) => {
            const Icon = MODE_ICONS[mode.id] ?? Hammer;
            const isActive = mode.id === activeId;
            return (
              <button
                key={mode.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={`mwikila-panel-${mode.id}`}
                id={`mwikila-tab-${mode.id}`}
                onClick={() => handleTabChange(mode.id)}
                className={`inline-flex items-center gap-2 rounded-md px-4 py-2.5 text-sm font-medium transition-[background-color,border-color,color,box-shadow] duration-base ease-out focus:outline-none focus:ring-2 focus:ring-signal-500 focus:ring-offset-2 focus:ring-offset-background ${
                  isActive
                    ? 'bg-signal-500 text-primary-foreground shadow-signal-glow'
                    : 'border border-border bg-surface text-neutral-400 hover:border-signal-500/40 hover:text-foreground'
                }`}
              >
                <Icon className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                <span>{mode.label}</span>
              </button>
            );
          })}
        </div>

        {/* Active tab panel */}
        <AnimatePresence mode="wait">
          <motion.div
            key={active.id}
            id={`mwikila-panel-${active.id}`}
            role="tabpanel"
            aria-labelledby={`mwikila-tab-${active.id}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden rounded-lg border border-border bg-surface"
          >
            <div className="grid md:grid-cols-[1.2fr_1fr]">
              {/* LEFT — headline + capabilities */}
              <div className="p-7 md:p-8">
                <div className="mb-5 flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-md bg-signal-500/15">
                    <ActiveIcon
                      className="h-5 w-5 text-signal-500"
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold tracking-tight text-foreground">
                      {active.headline}
                    </h3>
                    <span className="mt-1 inline-block rounded-sm bg-signal-500/10 px-2 py-0.5 font-mono text-meta uppercase tracking-widest text-signal-500">
                      {active.label}
                    </span>
                  </div>
                </div>
                <ul className="mt-6 space-y-3">
                  {active.capabilities.map((cap, i) => (
                    <motion.li
                      key={cap}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.06 }}
                      className="flex items-start gap-3"
                    >
                      <CheckCircle2
                        className="mt-0.5 h-5 w-5 shrink-0 text-signal-500"
                        strokeWidth={1.75}
                        aria-hidden="true"
                      />
                      <span className="text-sm leading-relaxed text-neutral-300">
                        {cap}
                      </span>
                    </motion.li>
                  ))}
                </ul>
              </div>

              {/* RIGHT — terminal-style mock pane */}
              <div className="border-t border-border bg-background/80 md:border-l md:border-t-0">
                <div className="flex items-center gap-2 border-b border-border px-4 py-2">
                  <div className="flex gap-1.5" aria-hidden="true">
                    <div className="h-2 w-2 rounded-full bg-neutral-500/30" />
                    <div className="h-2 w-2 rounded-full bg-neutral-500/30" />
                    <div className="h-2 w-2 rounded-full bg-neutral-500/30" />
                  </div>
                  <span className="ml-1 font-mono text-tiny uppercase tracking-widest text-neutral-500">
                    mr-mwikila / {active.label}
                  </span>
                </div>
                <div className="p-5">
                  <ModeMock modeId={active.id} />
                </div>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}

/**
 * ModeMock — small inline animated visual that varies by tab. Pure DOM,
 * Borjie palette, no images. Each mock is intentionally minimal so the
 * focus stays on the capability list to the left.
 */
function ModeMock({ modeId }: { readonly modeId: string }) {
  switch (modeId) {
    case 'build':
      return <BuildMock />;
    case 'strategy':
      return <StrategyMock />;
    case 'operations':
      return <OperationsMock />;
    case 'document':
      return <DocumentMock />;
    case 'finance':
      return <FinanceMock />;
    case 'risk':
      return <RiskMock />;
    case 'compliance':
      return <ComplianceMock />;
    default:
      return null;
  }
}

const STEPS = ['Import', 'OCR · KYB', 'Knowledge graph', 'Roles'] as const;
function BuildMock() {
  return (
    <div className="space-y-3">
      <div className="font-mono text-tiny uppercase tracking-widest text-neutral-500">
        Bootstrap · 48 hours
      </div>
      <div className="space-y-2">
        {STEPS.map((step, i) => (
          <motion.div
            key={step}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.12 }}
            className="flex items-center gap-3"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-signal-500/15 font-mono text-tiny font-semibold text-signal-500 tabular-nums">
              {i + 1}
            </span>
            <span className="text-sm text-foreground">{step}</span>
            <span className="ml-auto font-mono text-tiny text-success">
              OK
            </span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

const SCENARIOS = [
  { name: 'Bear · USD 1,750/oz', value: 'TZS 9.2B' },
  { name: 'Base · USD 1,920/oz', value: 'TZS 10.4B' },
  { name: 'Bull · USD 2,100/oz', value: 'TZS 11.6B' },
] as const;
function StrategyMock() {
  return (
    <div className="space-y-3">
      <div className="font-mono text-tiny uppercase tracking-widest text-neutral-500">
        12-month projection
      </div>
      {SCENARIOS.map((s, i) => (
        <motion.div
          key={s.name}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.1 }}
          className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2"
        >
          <span className="text-xs text-neutral-300">{s.name}</span>
          <span className="font-display text-sm font-semibold tabular-nums text-signal-500">
            {s.value}
          </span>
        </motion.div>
      ))}
    </div>
  );
}

const SHIFTS = [
  { label: 'Shift A · Geita', value: '212 t', tone: 'good' as const },
  { label: 'Shift B · Geita', value: '184 t', tone: 'good' as const },
  { label: 'Diesel burned', value: '412 L', tone: 'warn' as const },
  { label: 'Incidents', value: '0', tone: 'good' as const },
];
function OperationsMock() {
  return (
    <div className="space-y-2">
      <div className="font-mono text-tiny uppercase tracking-widest text-neutral-500">
        Overnight · 25 May
      </div>
      {SHIFTS.map((s, i) => (
        <motion.div
          key={s.label}
          initial={{ opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.08 }}
          className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2"
        >
          <span className="text-xs text-neutral-300">{s.label}</span>
          <span
            className={`font-mono text-xs font-semibold tabular-nums ${
              s.tone === 'good' ? 'text-success' : 'text-signal-500'
            }`}
          >
            {s.value}
          </span>
        </motion.div>
      ))}
    </div>
  );
}

function DocumentMock() {
  const docs = [
    'Mining Commission royalty · April · TZS 18.4M',
    'NEMC EIA · Q1 emissions',
    'OSHA shift log · 28 days',
    'Off-take · Pamoja Refinery · 60 oz',
  ];
  return (
    <div className="space-y-2">
      <div className="font-mono text-tiny uppercase tracking-widest text-neutral-500">
        Drafted · awaiting signature
      </div>
      {docs.map((d, i) => (
        <motion.div
          key={d}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.08 }}
          className="flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2"
        >
          <FileText className="h-3.5 w-3.5 shrink-0 text-signal-500" />
          <span className="truncate text-xs text-neutral-300">{d}</span>
        </motion.div>
      ))}
    </div>
  );
}

function FinanceMock() {
  return (
    <div className="space-y-3">
      <div className="font-mono text-tiny uppercase tracking-widest text-neutral-500">
        Treasury · live
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[
          { l: 'TZS', v: '412M' },
          { l: 'USD', v: '184k' },
          { l: 'Au oz', v: '184' },
        ].map((b) => (
          <div
            key={b.l}
            className="rounded-md border border-border bg-surface p-2 text-center"
          >
            <div className="font-display text-base font-semibold tabular-nums text-foreground">
              {b.v}
            </div>
            <div className="font-mono text-spark uppercase tracking-wider text-neutral-500">
              {b.l}
            </div>
          </div>
        ))}
      </div>
      <div className="rounded-md border border-signal-500/30 bg-signal-500/5 px-3 py-2 text-xs text-foreground">
        LBMA hedge proposal — 60 oz @ AM-fix
      </div>
    </div>
  );
}

const GATES = [
  'Groundedness',
  'Calibration',
  'Brand',
  'Authority',
  'Budget',
] as const;
function RiskMock() {
  return (
    <div className="space-y-2">
      <div className="font-mono text-tiny uppercase tracking-widest text-neutral-500">
        5-gate validator
      </div>
      {GATES.map((g, i) => (
        <motion.div
          key={g}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: i * 0.08, type: 'spring', stiffness: 280 }}
          className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2"
        >
          <span className="text-xs text-neutral-300">{g}</span>
          <span className="font-mono text-tiny uppercase tracking-widest text-success">
            PASS
          </span>
        </motion.div>
      ))}
    </div>
  );
}

function ComplianceMock() {
  const entries = [
    { seq: 18429, action: 'mine.turn_done', hash: '2e…440' },
    { seq: 18430, action: 'mine.royalty.draft', hash: '7c…918' },
    { seq: 18431, action: 'mine.licence.scan', hash: 'a3…4c1' },
  ];
  return (
    <div className="space-y-2">
      <div className="font-mono text-tiny uppercase tracking-widest text-neutral-500">
        Audit chain · last 3 entries
      </div>
      <div className="rounded-md border border-border bg-surface">
        {entries.map((e, i) => (
          <motion.div
            key={e.seq}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: i * 0.08 }}
            className="flex items-center justify-between border-b border-border px-3 py-2 last:border-b-0"
          >
            <span className="font-mono text-tiny text-neutral-500 tabular-nums">
              #{e.seq}
            </span>
            <span className="font-mono text-tiny text-neutral-300">
              {e.action}
            </span>
            <span className="font-mono text-tiny text-signal-500">
              {e.hash}
            </span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
