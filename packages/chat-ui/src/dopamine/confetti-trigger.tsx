/**
 * ConfettiTrigger — celebratory burst on a key event.
 *
 * Respects prefers-reduced-motion: when true, renders a subtle banner
 * instead of an animated burst.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { CelebrationTrigger } from './types.js';

export interface ConfettiTriggerProps {
  readonly active: boolean;
  readonly kind: CelebrationTrigger;
  readonly tenantId: string;
  readonly userId: string;
  readonly durationMs?: number;
  readonly particleCount?: number;
  readonly onComplete?: () => void;
}

interface Particle {
  readonly id: number;
  readonly leftPct: number;
  readonly delayMs: number;
  readonly color: string;
}

const PALETTE: readonly string[] = [
  '#f59e0b',
  '#10b981',
  '#3b82f6',
  '#ef4444',
  '#8b5cf6',
];

function usePrefersReducedMotion(): boolean {
  const [prefers, setPrefers] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefers(mq.matches);
    const handler = (e: MediaQueryListEvent) => setPrefers(e.matches);
    mq.addEventListener?.('change', handler);
    return () => mq.removeEventListener?.('change', handler);
  }, []);
  return prefers;
}

export function ConfettiTrigger(props: ConfettiTriggerProps): JSX.Element | null {
  const {
    active,
    kind,
    tenantId,
    userId,
    durationMs = 1500,
    particleCount = 24,
    onComplete,
  } = props;
  const prefersReduced = usePrefersReducedMotion();
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;

  const particles: readonly Particle[] = useMemo(() => {
    if (!active || prefersReduced) return [];
    return Array.from({ length: particleCount }, (_, i) => ({
      id: i,
      leftPct: Math.random() * 100,
      delayMs: Math.random() * 500,
      color: PALETTE[i % PALETTE.length] ?? '#3b82f6',
    }));
  }, [active, particleCount, prefersReduced]);

  useEffect(() => {
    if (!active) return;
    const handle = window.setTimeout(() => completeRef.current?.(), durationMs);
    return () => window.clearTimeout(handle);
  }, [active, durationMs]);

  if (!active) return null;

  const scope = `${tenantId}-${userId}-${kind}`;

  if (prefersReduced) {
    return (
      <div
        role="status"
        aria-live="polite"
        data-dopamine-scope={scope}
        className="fixed top-4 inset-x-0 mx-auto w-fit rounded px-4 py-2 bg-green-600 text-white text-sm shadow"
      >
        {`Celebrated: ${kind}`}
      </div>
    );
  }

  return (
    <div
      aria-hidden="true"
      data-dopamine-scope={scope}
      className="pointer-events-none fixed inset-0 overflow-hidden z-50"
    >
      {particles.map((p) => (
        <span
          key={p.id}
          data-particle-id={p.id}
          className="absolute top-0 w-2 h-3 rounded-sm"
          style={{
            left: `${p.leftPct}%`,
            backgroundColor: p.color,
            animation: `borjie-confetti-fall ${durationMs}ms ${p.delayMs}ms linear forwards`,
          }}
        />
      ))}
      <style>{`
        @keyframes borjie-confetti-fall {
          from { transform: translateY(-10vh) rotate(0deg); opacity: 1; }
          to { transform: translateY(110vh) rotate(720deg); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
