"use client";

/**
 * Achievement Unlock Component
 *
 * Full-screen overlay with badge reveal animation when a user
 * unlocks an achievement. Features:
 *   - Rarity-based visual treatment (legendary = gold shimmer,
 *     epic = purple glow, rare = blue sparkle, common = clean)
 *   - XP reward display with counter animation
 *   - Share button placeholder
 *   - Smooth enter/exit with framer-motion AnimatePresence
 *
 * Listens for `borjie-achievement-unlocked` CustomEvents.
 *
 * @module core/dopamine-design/components/AchievementUnlock
 */

import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ACHIEVEMENT_UNLOCKED_EVENT,
  type AchievementUnlockedEventDetail,
} from "../celebration-engine";
import {
  getBadgeById,
  RARITY_CONFIG,
  type AchievementBadge,
  type BadgeRarity,
} from "../achievement-badges";

// ============================================================================
// TYPES
// ============================================================================

interface UnlockState {
  readonly badge: AchievementBadge;
  readonly visible: boolean;
}

// ============================================================================
// RARITY VISUAL CONFIGS
// ============================================================================

const RARITY_ANIMATION: Readonly<
  Record<
    BadgeRarity,
    {
      readonly overlayBg: string;
      readonly iconScale: readonly number[];
      readonly glowColor: string;
      readonly shimmerOpacity: number;
      readonly ringColor: string;
    }
  >
> = {
  common: {
    overlayBg: "bg-black/50",
    iconScale: [0, 1.2, 1],
    glowColor: "rgba(148, 163, 184, 0.3)",
    shimmerOpacity: 0.05,
    ringColor: "ring-slate-400",
  },
  rare: {
    overlayBg: "bg-black/55",
    iconScale: [0, 1.3, 1],
    glowColor: "rgba(59, 130, 246, 0.4)",
    shimmerOpacity: 0.08,
    ringColor: "ring-blue-500",
  },
  epic: {
    overlayBg: "bg-black/60",
    iconScale: [0, 1.4, 1],
    glowColor: "rgba(139, 92, 246, 0.5)",
    shimmerOpacity: 0.12,
    ringColor: "ring-primary",
  },
  legendary: {
    overlayBg: "bg-black/65",
    iconScale: [0, 1.5, 1],
    glowColor: "rgba(245, 158, 11, 0.6)",
    shimmerOpacity: 0.15,
    ringColor: "ring-amber-500",
  },
} as const;

// ============================================================================
// CONSTANTS
// ============================================================================

const AUTO_DISMISS_MS = 5000;

// ============================================================================
// COMPONENT
// ============================================================================

interface AchievementUnlockProps {
  readonly language?: "en" | "sw";
}

export function AchievementUnlock({ language = "en" }: AchievementUnlockProps) {
  const [unlock, setUnlock] = useState<UnlockState | null>(null);

  const dismiss = useCallback(() => {
    setUnlock((prev) => (prev ? { ...prev, visible: false } : null));
    // Clear state after exit animation completes
    setTimeout(() => setUnlock(null), 400);
  }, []);

  const handleUnlock = useCallback(
    (detail: AchievementUnlockedEventDetail) => {
      const badge = getBadgeById(detail.badgeId);
      if (!badge) return;

      setUnlock({ badge, visible: true });

      // Auto-dismiss after delay
      setTimeout(() => {
        dismiss();
      }, AUTO_DISMISS_MS);
    },
    [dismiss],
  );

  useEffect(() => {
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<AchievementUnlockedEventDetail>;
      if (customEvent.detail) {
        handleUnlock(customEvent.detail);
      }
    };

    window.addEventListener(ACHIEVEMENT_UNLOCKED_EVENT, handler);
    return () =>
      window.removeEventListener(ACHIEVEMENT_UNLOCKED_EVENT, handler);
  }, [handleUnlock]);

  return (
    <AnimatePresence>
      {unlock?.visible && (
        <AchievementOverlay
          badge={unlock.badge}
          language={language}
          onDismiss={dismiss}
        />
      )}
    </AnimatePresence>
  );
}

// ============================================================================
// OVERLAY
// ============================================================================

interface OverlayProps {
  readonly badge: AchievementBadge;
  readonly language: "en" | "sw";
  readonly onDismiss: () => void;
}

function AchievementOverlay({ badge, language, onDismiss }: OverlayProps) {
  const anim = RARITY_ANIMATION[badge.rarity];
  const rarityConfig = RARITY_CONFIG[badge.rarity];
  const name = badge.name[language];
  const description = badge.description[language];
  const rarityLabel = rarityConfig.label[language];

  return (
    <motion.div
      className={`fixed inset-0 z-[10000] flex items-center justify-center ${anim.overlayBg} backdrop-blur-sm`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      onClick={onDismiss}
      role="dialog"
      aria-modal="true"
      aria-label={`Achievement unlocked: ${badge.name.en}`}
    >
      <motion.div
        className="relative flex flex-col items-center max-w-sm mx-4"
        initial={{ scale: 0.5, opacity: 0, y: 50 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.8, opacity: 0, y: 30 }}
        transition={{ type: "spring", stiffness: 200, damping: 15 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Glow ring behind badge */}
        <motion.div
          className="absolute top-8 w-32 h-32 rounded-full"
          style={{
            boxShadow: `0 0 60px 20px ${anim.glowColor}`,
          }}
          animate={{
            scale: [1, 1.15, 1],
            opacity: [0.5, 0.8, 0.5],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />

        {/* Badge icon container */}
        <motion.div
          className={`relative z-10 w-28 h-28 rounded-full bg-gradient-to-br ${badge.gradient} flex items-center justify-center ring-4 ${anim.ringColor} shadow-2xl`}
          initial={{ scale: 0, rotate: -180 }}
          animate={{
            scale: anim.iconScale as unknown as number[],
            rotate: 0,
          }}
          transition={{
            duration: 0.7,
            ease: "easeOut",
          }}
        >
          <span className="text-5xl text-white material-symbols-outlined">
            {badge.icon}
          </span>

          {/* Shimmer overlay on badge */}
          <motion.div
            className="absolute inset-0 rounded-full bg-gradient-to-r from-transparent via-white to-transparent pointer-events-none"
            style={{ opacity: anim.shimmerOpacity }}
            initial={{ x: "-100%", skewX: "-15deg" }}
            animate={{ x: "200%" }}
            transition={{
              delay: 0.8,
              duration: 1,
              ease: "easeInOut",
              repeat: Infinity,
              repeatDelay: 3,
            }}
          />
        </motion.div>

        {/* Achievement Unlocked header */}
        <motion.div
          className="mt-5 text-xs font-bold uppercase tracking-[0.2em] text-white/70"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          {language === "en"
            ? "Achievement Unlocked"
            : "Mafanikio Yamefunguliwa"}
        </motion.div>

        {/* Badge name */}
        <motion.h2
          className="mt-2 text-xl font-black text-white text-center"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
        >
          {name}
        </motion.h2>

        {/* Rarity label */}
        <motion.div
          className={`mt-1.5 rounded-full px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider ${getRarityLabelClasses(badge.rarity)}`}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.6 }}
        >
          {rarityLabel}
        </motion.div>

        {/* Description */}
        <motion.p
          className="mt-3 text-sm text-white/70 text-center max-w-xs leading-relaxed"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
        >
          {description}
        </motion.p>

        {/* XP Reward */}
        {badge.xpReward > 0 && (
          <motion.div
            className="mt-4 flex items-center gap-2"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8 }}
          >
            <XPCounter targetValue={badge.xpReward} />
          </motion.div>
        )}

        {/* Action buttons */}
        <motion.div
          className="mt-5 flex items-center gap-3"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.0 }}
        >
          {/* Share button placeholder */}
          <button
            className="rounded-full bg-white/10 hover:bg-white/20 transition-colors px-4 py-1.5 text-xs font-medium text-white/80 backdrop-blur-sm"
            onClick={(e) => {
              e.stopPropagation();
              // Share functionality placeholder
            }}
            type="button"
          >
            {language === "en" ? "Share" : "Shiriki"}
          </button>

          {/* Dismiss button */}
          <button
            className="rounded-full bg-white/20 hover:bg-white/30 transition-colors px-4 py-1.5 text-xs font-medium text-white backdrop-blur-sm"
            onClick={(e) => {
              e.stopPropagation();
              onDismiss();
            }}
            type="button"
          >
            {language === "en" ? "Continue" : "Endelea"}
          </button>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

// ============================================================================
// XP COUNTER ANIMATION
// ============================================================================

interface XPCounterProps {
  readonly targetValue: number;
}

function XPCounter({ targetValue }: XPCounterProps) {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    const duration = 800;
    const steps = 20;
    const stepDuration = duration / steps;
    const increment = targetValue / steps;
    let current = 0;
    let step = 0;

    const interval = setInterval(() => {
      step += 1;
      current = Math.min(Math.round(increment * step), targetValue);
      setDisplayValue(current);

      if (step >= steps) {
        clearInterval(interval);
        setDisplayValue(targetValue);
      }
    }, stepDuration);

    return () => clearInterval(interval);
  }, [targetValue]);

  return (
    <div className="flex items-center gap-1.5 rounded-full bg-amber-500/20 backdrop-blur-sm px-4 py-1.5">
      <motion.span
        className="text-lg text-amber-400"
        animate={{ rotate: [0, 15, -15, 0] }}
        transition={{ duration: 0.6, delay: 0.9 }}
      >
        &#x2726;
      </motion.span>
      <span className="text-sm font-bold text-amber-300">
        +{displayValue} XP
      </span>
    </div>
  );
}

// ============================================================================
// HELPERS
// ============================================================================

function getRarityLabelClasses(rarity: BadgeRarity): string {
  switch (rarity) {
    case "common":
      return "bg-slate-500/30 text-slate-300";
    case "rare":
      return "bg-blue-500/30 text-blue-300";
    case "epic":
      return "bg-primary/30 text-primary";
    case "legendary":
      return "bg-amber-500/30 text-amber-300";
    default:
      return "bg-slate-500/30 text-slate-300";
  }
}
