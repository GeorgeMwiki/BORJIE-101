/**
 * Timeline — Auto-Generator
 *
 * Turns a free-form project description into a structured `Timeline`:
 *   1. Calls the LLM-shaped `GeneratorFn` to propose milestones.
 *   2. Runs CPM to compute earliest-start, due-date, and the critical path.
 *   3. Returns the immutable `Timeline`.
 *
 * Ships a deterministic fallback generator so tests + CI run hermetically.
 *
 * @module features/central-command/md/timeline/auto-generator
 */

import { randomUUID } from "node:crypto";

import { createLogger } from "@/lib/logger";
import { runCpm } from "./cpm";
import {
  generatorInputSchema,
  type GeneratorFn,
  type GeneratorInput,
  type Milestone,
  type Timeline,
  type TimelineStyle,
} from "./types";

const log = createLogger("md.timeline.auto-generator");

/**
 * Deterministic heuristic generator. Extracts a duration target ("in N
 * months") from the description, then emits a standard 5-phase project
 * skeleton (Discovery → Plan → Build → QA → Launch). Designed to be
 * predictable for tests; the LLM-backed generator overrides this in prod.
 */
export const defaultGenerator: GeneratorFn = async (rawInput) => {
  const input = generatorInputSchema.parse(rawInput);
  const months = extractMonthHorizon(input.description) ?? 3;
  const totalDays = months * 30;
  const split = splitAcrossPhases(totalDays);

  const projectName =
    input.projectNameHint?.trim() ||
    deriveProjectName(input.description) ||
    "Untitled project";

  type RawMilestone = Omit<
    Milestone,
    "dueAt" | "earliestStartAt" | "onCriticalPath" | "status"
  >;

  const milestones: ReadonlyArray<RawMilestone> = Object.freeze([
    {
      id: "discovery",
      label: "Discovery & research",
      durationDays: split[0]!,
      dependencies: [],
    },
    {
      id: "plan",
      label: "Plan & design",
      durationDays: split[1]!,
      dependencies: ["discovery"],
    },
    {
      id: "build",
      label: "Build & implement",
      durationDays: split[2]!,
      dependencies: ["plan"],
    },
    {
      id: "qa",
      label: "QA & validation",
      durationDays: split[3]!,
      dependencies: ["build"],
    },
    {
      id: "launch",
      label: "Launch",
      durationDays: split[4]!,
      dependencies: ["qa"],
    },
  ]);

  return Object.freeze({
    projectName,
    milestones,
  });
};

/**
 * Build a fully scheduled `Timeline` from a description.
 */
export async function generateTimeline(
  input: GeneratorInput,
  generator: GeneratorFn = defaultGenerator,
  options: { readonly idGen?: () => string; readonly nowIso?: string } = {},
): Promise<Timeline> {
  const proposal = await generator(input);
  if (proposal.milestones.length === 0) {
    throw new Error("timeline: generator returned zero milestones");
  }
  const idGen = options.idGen ?? randomUUID;
  const cpm = runCpm({
    milestones: proposal.milestones,
    startsAt: input.startsAt,
  });

  const deps: Array<{ from: string; to: string }> = [];
  for (const m of cpm.milestones) {
    for (const d of m.dependencies) {
      deps.push(Object.freeze({ from: d, to: m.id }));
    }
  }

  const timeline = Object.freeze({
    id: idGen(),
    tenantId: input.tenantId,
    ownerId: input.ownerId,
    projectName: proposal.projectName,
    milestones: cpm.milestones,
    dependencies: Object.freeze(deps),
    style: input.style satisfies TimelineStyle,
    startsAt: input.startsAt,
    endsAt: cpm.endsAt,
    createdAt: options.nowIso ?? new Date().toISOString(),
    metadata: {
      totalDurationDays: cpm.totalDurationDays,
      criticalPath: [...cpm.criticalPath],
    },
  });

  log.info("timeline generated", {
    projectName: timeline.projectName,
    milestoneCount: timeline.milestones.length,
    durationDays: cpm.totalDurationDays,
    criticalLen: cpm.criticalPath.length,
  });

  return timeline as unknown as Timeline;
}

// ---------------- helpers ----------------

function extractMonthHorizon(text: string): number | null {
  const re = /(\d{1,3})\s*(months?|mos?|m)\b/i;
  const m = text.match(re);
  if (!m) {
    const weeks = text.match(/(\d{1,3})\s*weeks?\b/i);
    if (weeks) {
      const n = parseInt(weeks[1] ?? "", 10);
      if (!Number.isNaN(n) && n > 0) return Math.max(1, Math.round(n / 4));
    }
    return null;
  }
  const n = parseInt(m[1] ?? "", 10);
  return Number.isNaN(n) || n <= 0 ? null : n;
}

function deriveProjectName(text: string): string | null {
  // Look for "launch X", "build X", "ship X" → take X up to 5 words.
  const verbs = ["launch", "build", "ship", "release", "rollout"];
  for (const v of verbs) {
    const re = new RegExp(`\\b${v}\\s+([\\w\\s\\-]{2,80})`, "i");
    const m = text.match(re);
    if (m) {
      return capitalize(
        m[1]!.split(/[.,;]/)[0]!.trim().split(/\s+/).slice(0, 5).join(" "),
      );
    }
  }
  return null;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Allocate `totalDays` across the 5 standard phases.
 * Weights: discovery 15%, plan 15%, build 45%, qa 15%, launch 10%.
 * Always ≥ 1 day per phase.
 */
function splitAcrossPhases(totalDays: number): ReadonlyArray<number> {
  const weights = [0.15, 0.15, 0.45, 0.15, 0.1];
  const raw = weights.map((w) => Math.max(1, Math.round(totalDays * w)));
  return Object.freeze(raw);
}
