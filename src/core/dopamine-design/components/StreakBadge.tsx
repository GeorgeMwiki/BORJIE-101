"use client";

/**
 * Streak Badge Component
 *
 * Displays the user's current login streak with animated fire effects.
 * Features:
 *   - Fire emoji animation when streak is active
 *   - Pulse animation for active streaks
 *   - Gray/muted appearance when streak is broken
 *   - Compact variant for headers and navigation bars
 *
 * Uses framer-motion for animations, Tailwind for styling.
 *
 * @module core/dopamine-design/components/StreakBadge
 */

import React from "react";
import { motion } from "framer-motion";
import {
  getStreakMessage,
  getNextMilestone,
  getStreakProgressToNextMilestone,
} from "../streak-tracker";

// ============================================================================
// TYPES
// ============================================================================

interface StreakBadgeProps {
  readonly streakDays: number;
  readonly isActive: boolean;
  readonly variant?: "default" | "compact";
  readonly language?: "en" | "sw";
  readonly showProgress?: boolean;
  readonly className?: string;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function StreakBadge({
  streakDays,
  isActive,
  variant = "default",
  language = "en",
  showProgress = false,
  className = "",
}: StreakBadgeProps) {
  if (variant === "compact") {
    return (
      <CompactStreakBadge
        streakDays={streakDays}
        isActive={isActive}
        className={className}
      />
    );
  }

  return (
    <DefaultStreakBadge
      streakDays={streakDays}
      isActive={isActive}
      language={language}
      showProgress={showProgress}
      className={className}
    />
  );
}

// ============================================================================
// COMPACT VARIANT (for headers/nav)
// ============================================================================

interface CompactProps {
  readonly streakDays: number;
  readonly isActive: boolean;
  readonly className?: string;
}

function CompactStreakBadge({
  streakDays,
  isActive,
  className = "",
}: CompactProps) {
  return (
    <motion.div
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${
        isActive
          ? "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"
          : "bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500"
      } ${className}`}
      animate={
        isActive
          ? {
              scale: [1, 1.05, 1],
            }
          : undefined
      }
      transition={
        isActive
          ? {
              duration: 2,
              repeat: Infinity,
              ease: "easeInOut",
            }
          : undefined
      }
    >
      <StreakFireIcon isActive={isActive} size="small" />
      <span>{streakDays}</span>
    </motion.div>
  );
}

// ============================================================================
// DEFAULT VARIANT (full display)
// ============================================================================

interface DefaultProps {
  readonly streakDays: number;
  readonly isActive: boolean;
  readonly language: "en" | "sw";
  readonly showProgress: boolean;
  readonly className?: string;
}

function DefaultStreakBadge({
  streakDays,
  isActive,
  language,
  showProgress,
  className = "",
}: DefaultProps) {
  const message = getStreakMessage(streakDays, language);
  const nextMilestone = getNextMilestone(streakDays);
  const progress = getStreakProgressToNextMilestone(streakDays);

  return (
    <motion.div
      className={`rounded-xl border p-4 ${
        isActive
          ? "border-orange-300 bg-gradient-to-br from-orange-50 to-amber-50 dark:border-orange-700 dark:from-orange-950/30 dark:to-amber-950/30"
          : "border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/50"
      } ${className}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Header Row */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <StreakFireIcon isActive={isActive} size="large" />
          <div>
            <motion.span
              className={`text-2xl font-black ${
                isActive
                  ? "text-orange-600 dark:text-orange-400"
                  : "text-gray-400 dark:text-gray-500"
              }`}
              animate={isActive ? { scale: [1, 1.08, 1] } : undefined}
              transition={
                isActive
                  ? { duration: 1.5, repeat: Infinity, ease: "easeInOut" }
                  : undefined
              }
            >
              {streakDays}
            </motion.span>
            <span
              className={`ml-1 text-sm font-medium ${
                isActive
                  ? "text-orange-500 dark:text-orange-400"
                  : "text-gray-400 dark:text-gray-500"
              }`}
            >
              {language === "en" ? "day streak" : "mfululizo wa siku"}
            </span>
          </div>
        </div>

        {/* Status indicator */}
        {isActive ? (
          <motion.div
            className="flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 dark:bg-green-900/30"
            animate={{ opacity: [0.7, 1, 0.7] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <div className="h-1.5 w-1.5 rounded-full bg-green-500" />
            <span className="text-[10px] font-medium text-green-700 dark:text-green-400">
              {language === "en" ? "Active" : "Hai"}
            </span>
          </motion.div>
        ) : (
          <div className="flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 dark:bg-gray-800">
            <div className="h-1.5 w-1.5 rounded-full bg-gray-400" />
            <span className="text-[10px] font-medium text-gray-500">
              {language === "en" ? "Broken" : "Imevunjika"}
            </span>
          </div>
        )}
      </div>

      {/* Message */}
      <p
        className={`text-xs leading-relaxed ${
          isActive
            ? "text-orange-700/80 dark:text-orange-300/70"
            : "text-gray-400 dark:text-gray-500"
        }`}
      >
        {message}
      </p>

      {/* Progress to next milestone */}
      {showProgress && nextMilestone && isActive && (
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-medium text-orange-600/70 dark:text-orange-400/60">
              {language === "en"
                ? `Next: ${nextMilestone.title.en}`
                : `Inayofuata: ${nextMilestone.title.sw}`}
            </span>
            <span className="text-[10px] font-medium text-orange-600/70 dark:text-orange-400/60">
              {streakDays}/{nextMilestone.days}{" "}
              {language === "en" ? "days" : "siku"}
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-orange-200/50 dark:bg-orange-800/30 overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-orange-400 to-amber-500"
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.8, ease: "easeOut" }}
            />
          </div>
        </div>
      )}
    </motion.div>
  );
}

// ============================================================================
// FIRE ICON ANIMATION
// ============================================================================

interface FireIconProps {
  readonly isActive: boolean;
  readonly size: "small" | "large";
}

function StreakFireIcon({ isActive, size }: FireIconProps) {
  const sizeClass = size === "small" ? "text-sm" : "text-2xl";

  if (!isActive) {
    return (
      <span className={`${sizeClass} opacity-30 grayscale`}>&#x1F525;</span>
    );
  }

  return (
    <motion.span
      className={sizeClass}
      animate={{
        scale: [1, 1.15, 1],
        rotate: [0, 3, -3, 0],
      }}
      transition={{
        duration: 1.2,
        repeat: Infinity,
        ease: "easeInOut",
      }}
    >
      &#x1F525;
    </motion.span>
  );
}
