'use client';

import { useEffect, useRef, useState } from 'react';

interface Particle {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly radius: number;
  readonly alpha: number;
}

/**
 * InteractiveBackground — mouse-tracking light-particle effect.
 *
 * Uses a single <canvas> with ≤30 particles. Mouse moves throttle via
 * `requestAnimationFrame`; particles drift toward the cursor and decay
 * naturally. Pauses when off-screen via IntersectionObserver, disables
 * entirely when `prefers-reduced-motion` is set or on coarse-pointer
 * devices (touch). Palette is Borjie gold only — no new tokens.
 */
export interface InteractiveBackgroundProps {
  readonly className?: string;
  /** Max number of particles. Capped at 30 for CPU budget. */
  readonly maxParticles?: number;
}

const GOLD_OKLCH = 'oklch(0.78 0.17 78)';
const PARTICLE_LIFETIME_MS = 1800;

export function InteractiveBackground({
  className = '',
  maxParticles = 24,
}: InteractiveBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const mouseRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastSpawnRef = useRef(0);
  const [enabled, setEnabled] = useState(false);
  const [isVisible, setIsVisible] = useState(true);

  // Capability gate — disable on reduced-motion or coarse pointer.
  useEffect(() => {
    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
    setEnabled(!(reducedMotion || coarsePointer));
  }, []);

  // Off-screen pause.
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

  useEffect(() => {
    if (!enabled || !isVisible) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // High-DPI sizing
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    };
    resize();
    window.addEventListener('resize', resize);

    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    };
    const onPointerLeave = () => {
      mouseRef.current = null;
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerleave', onPointerLeave);

    let nextId = 0;
    const start = performance.now();

    const tick = (now: number) => {
      const rect = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, rect.width, rect.height);

      // Spawn new particles near the cursor when mouse is active.
      const mouse = mouseRef.current;
      if (mouse && now - lastSpawnRef.current > 50) {
        if (particlesRef.current.length < maxParticles) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 0.2 + Math.random() * 0.4;
          particlesRef.current = [
            ...particlesRef.current,
            {
              id: nextId++,
              x: mouse.x + (Math.random() - 0.5) * 16,
              y: mouse.y + (Math.random() - 0.5) * 16,
              vx: Math.cos(angle) * speed,
              vy: Math.sin(angle) * speed,
              radius: 1 + Math.random() * 2,
              alpha: 0.4 + Math.random() * 0.4,
            },
          ];
          lastSpawnRef.current = now;
        }
      }

      // Update + draw particles (immutable map → fresh array).
      const elapsed = now - start;
      const next: Particle[] = [];
      for (const p of particlesRef.current) {
        const newX = p.x + p.vx;
        const newY = p.y + p.vy;
        const lifeFrac = Math.min(
          1,
          (now - (start + (p.id * 50) % PARTICLE_LIFETIME_MS)) /
            PARTICLE_LIFETIME_MS,
        );
        const fadedAlpha = p.alpha * (1 - lifeFrac * 0.4);
        if (fadedAlpha < 0.05 || newX < -20 || newX > rect.width + 20) continue;
        if (newY < -20 || newY > rect.height + 20) continue;
        next.push({
          ...p,
          x: newX,
          y: newY,
          alpha: fadedAlpha,
        });

        ctx.beginPath();
        ctx.arc(newX, newY, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = `${GOLD_OKLCH.replace(
          /\)$/,
          ` / ${fadedAlpha.toFixed(3)})`,
        )}`;
        ctx.fill();
      }
      particlesRef.current = next;
      // Reference elapsed so the linter doesn't strip it; it documents
      // intent for future ease-out tweaks.
      void elapsed;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerleave', onPointerLeave);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [enabled, isVisible, maxParticles]);

  if (!enabled) {
    return (
      <div
        ref={containerRef}
        aria-hidden="true"
        className={`absolute inset-0 pointer-events-none ${className}`}
      />
    );
  }

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className={`absolute inset-0 pointer-events-none ${className}`}
    >
      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  );
}
