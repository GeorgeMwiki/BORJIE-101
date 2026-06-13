"use client";

/**
 * escalations-copy — complete en + sw strings for the Escalations tab.
 *
 * Hard rule: SINGLE LANGUAGE per locale. A render picks exactly one
 * dictionary; en and sw strings never mix in the same surface. Both
 * locales carry the full key set so a toggle is absolute.
 *
 * @module features/central-command/md/escalations/ui/escalations-copy
 */

import type {
  EscalationSeverity,
  EscalationStatus,
} from "./escalations-client";

export type EscalationsLocale = "en" | "sw";

export interface EscalationsCopy {
  readonly loading: string;
  readonly signInRequired: string;
  readonly loadFailed: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  readonly headerOpen: (n: number) => string;
  readonly liveHint: string;
  readonly acknowledge: string;
  readonly resolve: string;
  readonly acknowledging: string;
  readonly resolving: string;
  readonly actionFailed: string;
  readonly openedPrefix: string;
  readonly justNow: string;
  readonly minutesAgo: (m: number) => string;
  readonly hoursAgo: (h: number) => string;
  readonly severity: Record<EscalationSeverity, string>;
  readonly status: Record<EscalationStatus, string>;
}

const EN: EscalationsCopy = {
  loading: "Loading escalations…",
  signInRequired: "Sign in to view this tab.",
  loadFailed: "Could not load escalations. Please try again.",
  emptyTitle: "No open escalations",
  emptyBody:
    "When a worker, manager, or the MD raises something to a human, it appears here in real time.",
  headerOpen: (n) => `Open escalations (${n})`,
  liveHint: "Authoritative ladder · acknowledge or resolve to close",
  acknowledge: "Acknowledge",
  resolve: "Resolve",
  acknowledging: "Acknowledging…",
  resolving: "Resolving…",
  actionFailed: "Action failed. Please try again.",
  openedPrefix: "Opened",
  justNow: "just now",
  minutesAgo: (m) => `${m}m ago`,
  hoursAgo: (h) => `${h}h ago`,
  severity: { info: "Info", warning: "Warning", critical: "Critical" },
  status: { open: "Open", acknowledged: "Acknowledged", resolved: "Resolved" },
};

const SW: EscalationsCopy = {
  loading: "Inapakia taarifa za dharura…",
  signInRequired: "Ingia ili kuona kichupo hiki.",
  loadFailed: "Imeshindwa kupakia taarifa za dharura. Tafadhali jaribu tena.",
  emptyTitle: "Hakuna taarifa za dharura zilizo wazi",
  emptyBody:
    "Mfanyakazi, meneja, au MD anapopandisha jambo kwa binadamu, linaonekana hapa papo hapo.",
  headerOpen: (n) => `Taarifa za dharura zilizo wazi (${n})`,
  liveHint: "Ngazi rasmi · thibitisha au tatua ili kufunga",
  acknowledge: "Thibitisha",
  resolve: "Tatua",
  acknowledging: "Inathibitisha…",
  resolving: "Inatatua…",
  actionFailed: "Hatua imeshindwa. Tafadhali jaribu tena.",
  openedPrefix: "Ilifunguliwa",
  justNow: "sasa hivi",
  minutesAgo: (m) => `dakika ${m} zilizopita`,
  hoursAgo: (h) => `saa ${h} zilizopita`,
  severity: { info: "Taarifa", warning: "Onyo", critical: "Hatari" },
  status: {
    open: "Wazi",
    acknowledged: "Imethibitishwa",
    resolved: "Imetatuliwa",
  },
};

const DICTIONARIES: Record<EscalationsLocale, EscalationsCopy> = {
  en: EN,
  sw: SW,
};

export function escalationsCopy(locale: EscalationsLocale): EscalationsCopy {
  return DICTIONARIES[locale];
}
