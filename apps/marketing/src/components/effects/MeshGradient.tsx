'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';

/**
 * MeshGradient — Stripe-inspired animated mesh-gradient background.
 *
 * Borjie palette only: gold (signal-500), deep navy (background), cream
 * (foreground). Four soft radial orbs drift in slow loops behind
 * content. IntersectionObserver pauses motion when off-screen.
 * `prefers-reduced-motion` disables the animation entirely — the orbs
 * stay parked in their resting positions.
 */
export interface MeshGradientProps {
  readonly className?: string;
  readonly speed?: number;
}

// Borjie OKLCH tokens — gold, warm gold (hover), deep navy. NO new
// colour tokens; each entry mirrors a value already in the design
// system so this stays Layer-3 compliant.
const ORB_COLORS = [
  'oklch(0.78 0.17 78 / 0.22)', // signal-500 gold
  'oklch(0.84 0.15 80 / 0.18)', // accent warm gold
  'oklch(0.58 0.12 65 / 0.14)', // signal-700 deep gold
  'oklch(0.96 0.005 95 / 0.08)', // foreground cream
] as const;

export function MeshGradient({
  className = '',
  speed = 1,
}: MeshGradientProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    setReducedMotion(
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    );
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry) setIsVisible(entry.isIntersecting);
      },
      { threshold: 0.05 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const duration = 20 / speed;
  const shouldAnimate = isVisible && !reducedMotion;

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className={`absolute inset-0 overflow-hidden ${className}`}
    >
      {/* Orb 1 — top-left, large gold */}
      <motion.div
        className="absolute w-skel-70 h-skel-70 rounded-full blur-[100px]"
        style={{
          background: `radial-gradient(circle, ${ORB_COLORS[0]} 0%, transparent 70%)`,
          left: '-15%',
          top: '-15%',
        }}
        animate={
          shouldAnimate
            ? {
                x: ['0%', '15%', '-5%', '10%', '0%'],
                y: ['0%', '-10%', '15%', '-5%', '0%'],
              }
            : {}
        }
        transition={{
          duration,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />

      {/* Orb 2 — top-right, warm gold */}
      <motion.div
        className="absolute w-skel-60 h-skel-60 rounded-full blur-[120px]"
        style={{
          background: `radial-gradient(circle, ${ORB_COLORS[1]} 0%, transparent 70%)`,
          right: '-10%',
          top: '-10%',
        }}
        animate={
          shouldAnimate
            ? {
                x: ['0%', '-20%', '10%', '-15%', '0%'],
                y: ['0%', '15%', '-10%', '20%', '0%'],
              }
            : {}
        }
        transition={{
          duration: duration * 1.3,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />

      {/* Orb 3 — bottom-center, deeper gold */}
      <motion.div
        className="absolute w-skel-50 h-skel-50 rounded-full blur-[80px]"
        style={{
          background: `radial-gradient(circle, ${ORB_COLORS[2]} 0%, transparent 70%)`,
          bottom: '-5%',
          left: '25%',
        }}
        animate={
          shouldAnimate
            ? {
                x: ['0%', '20%', '-10%', '15%', '0%'],
                y: ['0%', '-15%', '5%', '-20%', '0%'],
              }
            : {}
        }
        transition={{
          duration: duration * 0.9,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />

      {/* Orb 4 — center, cream highlight */}
      <motion.div
        className="absolute w-skel-40 h-skel-40 rounded-full blur-[100px]"
        style={{
          background: `radial-gradient(circle, ${ORB_COLORS[3]} 0%, transparent 70%)`,
          top: '30%',
          left: '30%',
        }}
        animate={
          shouldAnimate
            ? {
                x: ['0%', '-15%', '20%', '-10%', '0%'],
                y: ['0%', '20%', '-15%', '10%', '0%'],
                scale: [1, 1.1, 0.95, 1.05, 1],
              }
            : {}
        }
        transition={{
          duration: duration * 1.1,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />

      {/* Fine noise overlay — geological grit texture */}
      <div
        className="absolute inset-0 opacity-[0.025]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E\")",
          backgroundSize: '128px 128px',
        }}
      />
    </div>
  );
}
