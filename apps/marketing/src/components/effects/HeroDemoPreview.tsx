'use client';

import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

/**
 * HeroDemoPreview — 240x180 mockup tile showing a fake KPI strip.
 *
 * Pure DOM: gold-bordered card with three tabular-num KPI columns plus
 * a hairline gold underline that pulses on mount. Used as a decorative
 * teaser chip alongside hero copy in narrow viewports. Honours
 * `prefers-reduced-motion`.
 */
export interface HeroDemoPreviewProps {
  readonly className?: string;
}

const KPIS = [
  { label: 'Oz Au', value: '184' },
  { label: 'TZS hedged', value: '4.2B' },
  { label: 'Days to renew', value: '47' },
] as const;

export function HeroDemoPreview({ className = '' }: HeroDemoPreviewProps) {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    setReducedMotion(
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    );
  }, []);

  const motionProps = reducedMotion
    ? {}
    : {
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.4, delay: 0.2 },
      };

  return (
    <motion.div
      {...motionProps}
      className={`relative w-[240px] h-[180px] overflow-hidden rounded-xl border border-border bg-surface px-4 py-3 shadow-md ${className}`}
      role="img"
      aria-label="Mock KPI tile — gold ounces, TZS hedged, days to licence renewal"
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-meta uppercase tracking-widest text-neutral-500">
          06:00 Brief
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-signal-500/15 px-2 py-0.5 text-tiny font-medium text-signal-500">
          <span className="h-1 w-1 rounded-full bg-signal-500" aria-hidden="true" />
          Live
        </span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {KPIS.map((k, idx) => (
          <motion.div
            key={k.label}
            initial={reducedMotion ? false : { opacity: 0, y: 6 }}
            {...(reducedMotion
              ? {}
              : {
                  animate: { opacity: 1, y: 0 },
                  transition: { duration: 0.3, delay: 0.3 + idx * 0.08 },
                })}
            className="rounded-md bg-background/60 px-2 py-2 text-center"
          >
            <div className="font-display text-xl font-semibold tabular-nums text-foreground">
              {k.value}
            </div>
            <div className="font-mono text-spark uppercase tracking-wider text-neutral-500">
              {k.label}
            </div>
          </motion.div>
        ))}
      </div>

      {/* Bottom gold hairline */}
      <div className="absolute inset-x-3 bottom-3 h-px overflow-hidden rounded-full bg-border">
        <motion.div
          initial={reducedMotion ? false : { width: '10%' }}
          {...(reducedMotion
            ? {}
            : {
                animate: { width: '70%' },
                transition: { duration: 1.6, ease: 'easeOut' as const, delay: 0.6 },
              })}
          className="h-full"
          style={{
            background:
              'linear-gradient(90deg, oklch(0.78 0.17 78) 0%, oklch(0.84 0.15 80) 100%)',
          }}
        />
      </div>
    </motion.div>
  );
}
