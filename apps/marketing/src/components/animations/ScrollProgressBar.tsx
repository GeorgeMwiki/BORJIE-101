'use client';

import { useEffect, useState } from 'react';

/**
 * ScrollProgressBar — 2px fixed top bar that fills as the user scrolls
 * the page. Mirrors the LitFin marketing pattern: a thin gold gradient
 * tracking `scrollY / (docHeight - viewportHeight)` from 0 to 1.
 *
 * Respects `prefers-reduced-motion`: when reduced motion is requested we
 * still update the bar width (it's strictly informational), but we drop
 * the CSS transition so the bar jumps to its target instead of easing.
 *
 * Uses the Borjie OKLCH gold token directly so the bar reads as part of
 * the brand language, never a foreign accent.
 */
export function ScrollProgressBar() {
  const [progress, setProgress] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReducedMotion(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    let ticking = false;
    const update = () => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      const next = max <= 0 ? 0 : Math.min(1, Math.max(0, window.scrollY / max));
      setProgress(next);
      ticking = false;
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', update);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-[2px]"
    >
      <div
        className="h-full origin-left"
        style={{
          width: `${progress * 100}%`,
          background:
            'linear-gradient(90deg, oklch(0.78 0.17 78) 0%, oklch(0.78 0.17 78) 65%, oklch(0.78 0.17 78 / 0) 100%)',
          transition: reducedMotion ? 'none' : 'width 80ms linear',
        }}
      />
    </div>
  );
}
