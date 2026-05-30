"use client";

/**
 * Confetti Overlay Component
 *
 * Listens for `borjie-celebration` CustomEvents and triggers
 * canvas-confetti animations. Supports three confetti styles:
 *   - burst: Quick pop of particles (quiz correct, small wins)
 *   - shower: Sustained rain of particles (module complete, mastery)
 *   - fireworks: Multiple bursts with delays (level up, graduation)
 *
 * Uses dynamic import of canvas-confetti to avoid SSR issues.
 * Zero impact when no celebration is active (no re-renders).
 *
 * @module core/dopamine-design/components/ConfettiOverlay
 */

import { useEffect, useRef, useCallback } from "react";
import {
  CELEBRATION_EVENT,
  type CelebrationEventDetail,
  type ConfettiStyle,
} from "../celebration-engine";

// ============================================================================
// CONFETTI CONFIGURATIONS
// ============================================================================

interface ConfettiFireParams {
  readonly particleCount: number;
  readonly spread: number;
  readonly origin: { readonly x: number; readonly y: number };
  readonly colors: readonly string[];
  readonly startVelocity?: number;
  readonly decay?: number;
  readonly gravity?: number;
  readonly ticks?: number;
  readonly scalar?: number;
}

function buildBurstConfig(
  particleCount: number,
  colors: readonly string[],
): readonly ConfettiFireParams[] {
  return [
    {
      particleCount,
      spread: 60,
      origin: { x: 0.5, y: 0.7 },
      colors: [...colors],
      startVelocity: 30,
      decay: 0.94,
      ticks: 100,
    },
  ];
}

function buildShowerConfig(
  particleCount: number,
  colors: readonly string[],
): readonly ConfettiFireParams[] {
  const perBurst = Math.ceil(particleCount / 4);
  return [
    {
      particleCount: perBurst,
      spread: 70,
      origin: { x: 0.3, y: 0.6 },
      colors: [...colors],
      startVelocity: 25,
      decay: 0.92,
      ticks: 150,
    },
    {
      particleCount: perBurst,
      spread: 70,
      origin: { x: 0.7, y: 0.6 },
      colors: [...colors],
      startVelocity: 25,
      decay: 0.92,
      ticks: 150,
    },
    {
      particleCount: perBurst,
      spread: 80,
      origin: { x: 0.5, y: 0.5 },
      colors: [...colors],
      startVelocity: 30,
      decay: 0.93,
      ticks: 160,
    },
    {
      particleCount: perBurst,
      spread: 90,
      origin: { x: 0.5, y: 0.7 },
      colors: [...colors],
      startVelocity: 20,
      decay: 0.91,
      ticks: 180,
    },
  ];
}

function buildFireworksConfig(
  particleCount: number,
  colors: readonly string[],
): readonly ConfettiFireParams[] {
  const perBurst = Math.ceil(particleCount / 6);
  return [
    {
      particleCount: perBurst,
      spread: 50,
      origin: { x: 0.3, y: 0.5 },
      colors: [...colors],
      startVelocity: 40,
      gravity: 0.8,
      ticks: 200,
    },
    {
      particleCount: perBurst,
      spread: 50,
      origin: { x: 0.7, y: 0.5 },
      colors: [...colors],
      startVelocity: 40,
      gravity: 0.8,
      ticks: 200,
    },
    {
      particleCount: perBurst,
      spread: 60,
      origin: { x: 0.5, y: 0.4 },
      colors: [...colors],
      startVelocity: 45,
      gravity: 0.7,
      scalar: 1.2,
      ticks: 220,
    },
    {
      particleCount: perBurst,
      spread: 40,
      origin: { x: 0.2, y: 0.6 },
      colors: [...colors],
      startVelocity: 35,
      gravity: 0.9,
      ticks: 180,
    },
    {
      particleCount: perBurst,
      spread: 40,
      origin: { x: 0.8, y: 0.6 },
      colors: [...colors],
      startVelocity: 35,
      gravity: 0.9,
      ticks: 180,
    },
    {
      particleCount: perBurst,
      spread: 100,
      origin: { x: 0.5, y: 0.7 },
      colors: [...colors],
      startVelocity: 50,
      gravity: 0.6,
      scalar: 1.3,
      ticks: 250,
    },
  ];
}

function getConfettiConfigs(
  style: ConfettiStyle,
  particleCount: number,
  colors: readonly string[],
): readonly ConfettiFireParams[] {
  switch (style) {
    case "burst":
      return buildBurstConfig(particleCount, colors);
    case "shower":
      return buildShowerConfig(particleCount, colors);
    case "fireworks":
      return buildFireworksConfig(particleCount, colors);
    default:
      return buildBurstConfig(particleCount, colors);
  }
}

// ============================================================================
// COMPONENT
// ============================================================================

export function ConfettiOverlay() {
  const timeoutsRef = useRef<readonly number[]>([]);

  const clearTimeouts = useCallback(() => {
    for (const t of timeoutsRef.current) {
      window.clearTimeout(t);
    }
    timeoutsRef.current = [];
  }, []);

  const fireConfetti = useCallback(
    async (detail: CelebrationEventDetail) => {
      try {
        const confettiModule = await import("canvas-confetti");
        const confetti = confettiModule.default;

        const configs = getConfettiConfigs(
          detail.spec.confettiStyle,
          detail.spec.confettiParticleCount,
          detail.spec.confettiColors,
        );

        // Clear any pending timeouts from previous celebrations
        clearTimeouts();

        const newTimeouts: number[] = [];

        configs.forEach((config, index) => {
          const delay = index * 200;
          const timeout = window.setTimeout(() => {
            confetti({
              particleCount: config.particleCount,
              spread: config.spread,
              origin: { x: config.origin.x, y: config.origin.y },
              colors: [...config.colors],
              startVelocity: config.startVelocity,
              decay: config.decay,
              gravity: config.gravity,
              ticks: config.ticks,
              scalar: config.scalar,
              disableForReducedMotion: true,
            });
          }, delay);
          newTimeouts.push(timeout);
        });

        timeoutsRef.current = newTimeouts;
      } catch {
        // canvas-confetti not available or import failed; skip gracefully
      }
    },
    [clearTimeouts],
  );

  useEffect(() => {
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<CelebrationEventDetail>;
      if (customEvent.detail) {
        fireConfetti(customEvent.detail);
      }
    };

    window.addEventListener(CELEBRATION_EVENT, handler);

    return () => {
      window.removeEventListener(CELEBRATION_EVENT, handler);
      clearTimeouts();
    };
  }, [fireConfetti, clearTimeouts]);

  // This component renders nothing to the DOM.
  // Confetti is drawn on a canvas created by canvas-confetti.
  return null;
}
