'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * CountUp — animates a numeric counter from 0 to `target` over 1.6s with
 * an ease-out-cubic curve, triggered the first time the element enters
 * the viewport (via IntersectionObserver, threshold 0.4).
 *
 * Supports a leading prefix (e.g. "TZS ") and trailing suffix (e.g. "k",
 * "B"). Honours `prefers-reduced-motion`: when reduced, it snaps to the
 * final value on intersect with no tween.
 */
export interface CountUpProps {
  readonly target: number;
  readonly prefix?: string;
  readonly suffix?: string;
  readonly decimals?: number;
  readonly durationMs?: number;
  readonly className?: string;
}

const EASE_OUT_CUBIC = (t: number): number => 1 - Math.pow(1 - t, 3);

function formatNumber(value: number, decimals: number): string {
  if (decimals > 0) return value.toFixed(decimals);
  return Math.round(value).toLocaleString('en-US');
}

export function CountUp({
  target,
  prefix = '',
  suffix = '',
  decimals = 0,
  durationMs = 1600,
  className = '',
}: CountUpProps) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [value, setValue] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (done) return;
    const node = ref.current;
    if (!node) return;

    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          setDone(true);
          if (reducedMotion) {
            setValue(target);
            observer.disconnect();
            return;
          }
          const start = performance.now();
          let frame = 0;
          const tick = (now: number) => {
            const elapsed = now - start;
            const t = Math.min(1, elapsed / durationMs);
            setValue(target * EASE_OUT_CUBIC(t));
            if (t < 1) {
              frame = requestAnimationFrame(tick);
            } else {
              setValue(target);
              cancelAnimationFrame(frame);
            }
          };
          frame = requestAnimationFrame(tick);
          observer.disconnect();
        }
      },
      { threshold: 0.4 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [target, durationMs, done]);

  return (
    <span ref={ref} className={`tabular-nums ${className}`.trim()}>
      {prefix}
      {formatNumber(value, decimals)}
      {suffix}
    </span>
  );
}
