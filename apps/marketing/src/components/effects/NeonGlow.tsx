'use client';

import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

/**
 * NeonGlow — softly pulsing radial-gradient orb for dark sections.
 *
 * Borjie-locked palette: gold (signal-500) or navy (background). No new
 * colour tokens. The orb is absolutely positioned, blur-3xl, and
 * pointer-events-none so it never interferes with content. Animation
 * collapses to a static orb when `prefers-reduced-motion` is set.
 */
export type NeonGlowTone = 'gold' | 'navy';
export type NeonGlowSize = 'sm' | 'md' | 'lg' | 'xl';
export type NeonGlowPosition =
  | 'left'
  | 'right'
  | 'center'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

export interface NeonGlowProps {
  readonly className?: string;
  readonly tone?: NeonGlowTone;
  readonly size?: NeonGlowSize;
  readonly position?: NeonGlowPosition;
  readonly intensity?: number;
  readonly animated?: boolean;
}

const SIZES: Record<NeonGlowSize, string> = {
  sm: 'w-48 h-48',
  md: 'w-72 h-72',
  lg: 'w-96 h-96',
  xl: 'w-[32rem] h-[32rem]',
};

const POSITIONS: Record<NeonGlowPosition, string> = {
  left: '-left-24 top-1/2 -translate-y-1/2',
  right: '-right-24 top-1/2 -translate-y-1/2',
  center: 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
  'top-left': '-left-12 -top-12',
  'top-right': '-right-12 -top-12',
  'bottom-left': '-left-12 -bottom-12',
  'bottom-right': '-right-12 -bottom-12',
};

const TONE_COLOR: Record<NeonGlowTone, string> = {
  gold: 'oklch(0.78 0.17 78)',
  navy: 'oklch(0.32 0.06 260)',
};

export function NeonGlow({
  className = '',
  tone = 'gold',
  size = 'lg',
  position = 'center',
  intensity = 0.18,
  animated = true,
}: NeonGlowProps) {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    setReducedMotion(
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    );
  }, []);

  const shouldAnimate = animated && !reducedMotion;
  const color = TONE_COLOR[tone];

  const animateProps = shouldAnimate
    ? {
        animate: {
          scale: [1, 1.15, 1],
          opacity: [intensity, intensity * 1.4, intensity],
        },
        transition: {
          duration: 8,
          repeat: Infinity,
          ease: 'easeInOut' as const,
        },
      }
    : {};

  return (
    <motion.div
      aria-hidden="true"
      className={`absolute pointer-events-none rounded-full blur-3xl ${SIZES[size]} ${POSITIONS[position]} ${className}`}
      style={{
        background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
        opacity: intensity,
      }}
      {...animateProps}
    />
  );
}
