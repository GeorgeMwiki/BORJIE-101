"use client";

/**
 * XP Toast Component
 *
 * Animated toast notification that shows "+N XP" with a bounce animation.
 * Displays a level-up animation when a level threshold is crossed.
 * Listens for `borjie-xp-gained` CustomEvents.
 * Auto-dismisses after 2 seconds.
 *
 * Uses framer-motion for animations, Tailwind for styling.
 *
 * @module core/dopamine-design/components/XPToast
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  XP_GAINED_EVENT,
  type XPGainedEventDetail,
} from "../celebration-engine";
import { getLevelTitle, getLevelColor } from "../xp-system";

// ============================================================================
// TYPES
// ============================================================================

interface ToastEntry {
  readonly id: number;
  readonly amount: number;
  readonly leveledUp: boolean;
  readonly newLevel?: number;
  readonly timestamp: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const TOAST_DURATION_MS = 2000;
const LEVEL_UP_DURATION_MS = 3500;
const MAX_VISIBLE_TOASTS = 3;

// ============================================================================
// COMPONENT
// ============================================================================

export function XPToast() {
  const [toasts, setToasts] = useState<readonly ToastEntry[]>([]);
  const counterRef = useRef(0);

  const addToast = useCallback((detail: XPGainedEventDetail) => {
    counterRef.current += 1;
    const newToast: ToastEntry = {
      id: counterRef.current,
      amount: detail.amount,
      leveledUp: detail.leveledUp,
      newLevel: detail.newLevel,
      timestamp: detail.timestamp,
    };

    setToasts((prev) => {
      const updated = [...prev, newToast];
      // Keep only the most recent toasts visible
      if (updated.length > MAX_VISIBLE_TOASTS) {
        return updated.slice(updated.length - MAX_VISIBLE_TOASTS);
      }
      return updated;
    });

    // Auto-dismiss
    const duration = detail.leveledUp
      ? LEVEL_UP_DURATION_MS
      : TOAST_DURATION_MS;
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== newToast.id));
    }, duration);
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<XPGainedEventDetail>;
      if (customEvent.detail && customEvent.detail.amount > 0) {
        addToast(customEvent.detail);
      }
    };

    window.addEventListener(XP_GAINED_EVENT, handler);
    return () => window.removeEventListener(XP_GAINED_EVENT, handler);
  }, [addToast]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col items-end gap-2 pointer-events-none">
      <AnimatePresence mode="popLayout">
        {toasts.map((toast, index) => (
          <motion.div
            key={toast.id}
            layout
            initial={{ opacity: 0, y: -20, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.9 }}
            transition={{
              type: "spring",
              stiffness: 400,
              damping: 20,
              delay: index * 0.05,
            }}
          >
            {toast.leveledUp && toast.newLevel ? (
              <LevelUpToast level={toast.newLevel} xpAmount={toast.amount} />
            ) : (
              <XPGainToast amount={toast.amount} />
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// XP GAIN TOAST (simple +N XP)
// ============================================================================

interface XPGainToastProps {
  readonly amount: number;
}

function XPGainToast({ amount }: XPGainToastProps) {
  return (
    <motion.div
      className="flex items-center gap-1.5 rounded-full bg-amber-500/90 backdrop-blur-sm px-3 py-1.5 shadow-lg shadow-amber-500/30"
      animate={{
        y: [0, -4, 0],
      }}
      transition={{
        duration: 0.4,
        ease: "easeOut",
      }}
    >
      <motion.span
        className="text-lg"
        animate={{ rotate: [0, 15, -15, 0] }}
        transition={{ duration: 0.5, delay: 0.1 }}
      >
        &#x2726;
      </motion.span>
      <span className="text-sm font-bold text-white">+{amount} XP</span>
    </motion.div>
  );
}

// ============================================================================
// LEVEL UP TOAST (expanded with level info)
// ============================================================================

interface LevelUpToastProps {
  readonly level: number;
  readonly xpAmount: number;
}

function LevelUpToast({ level, xpAmount }: LevelUpToastProps) {
  const levelColor = getLevelColor(level);
  const titleEn = getLevelTitle(level, "en");

  return (
    <motion.div
      className="flex flex-col items-center rounded-xl bg-gradient-to-br from-primary/95 to-primary/95 backdrop-blur-sm px-5 py-3 shadow-xl shadow-primary/40 min-w-[180px]"
      animate={{
        scale: [1, 1.05, 1],
        boxShadow: [
          "0 10px 25px rgba(139, 92, 246, 0.4)",
          "0 15px 35px rgba(139, 92, 246, 0.6)",
          "0 10px 25px rgba(139, 92, 246, 0.4)",
        ],
      }}
      transition={{
        duration: 1.5,
        repeat: 1,
        ease: "easeInOut",
      }}
    >
      {/* Level Up Header */}
      <motion.div
        className="flex items-center gap-1.5 mb-1"
        initial={{ scale: 0 }}
        animate={{ scale: [0, 1.3, 1] }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      >
        <span className="text-xl">&#x2B06;&#xFE0F;</span>
        <span className="text-xs font-bold text-white/90 uppercase tracking-wider">
          Level Up!
        </span>
      </motion.div>

      {/* Level Number */}
      <motion.div
        className="text-2xl font-black text-white"
        style={{ textShadow: `0 0 20px ${levelColor}` }}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        Level {level}
      </motion.div>

      {/* Level Title */}
      <motion.div
        className="text-xs text-white/80 font-medium"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
      >
        {titleEn}
      </motion.div>

      {/* XP Bonus */}
      {xpAmount > 0 && (
        <motion.div
          className="mt-1.5 flex items-center gap-1 text-amber-300 text-xs font-bold"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
        >
          <span>&#x2726;</span>
          <span>+{xpAmount} XP</span>
        </motion.div>
      )}

      {/* Shimmer effect */}
      <motion.div
        className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -skew-x-12 pointer-events-none rounded-xl overflow-hidden"
        initial={{ x: "-100%" }}
        animate={{ x: "200%" }}
        transition={{ delay: 0.5, duration: 0.8, ease: "easeInOut" }}
      />
    </motion.div>
  );
}
