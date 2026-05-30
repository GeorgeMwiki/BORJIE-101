/**
 * Employees — Onboarding Planner
 *
 * Drafts a 30-60-90 plan + 1-on-1 cadence for a newly-added employee.
 * Pure: given an employee + start date, returns the immutable plan.
 *
 * The default plan template is role-agnostic; callers may provide
 * role-specific objectives via `overrides`.
 *
 * @module features/central-command/md/employees/onboarding-planner
 */

import { randomUUID } from "node:crypto";

import {
  onboardingPlanSchema,
  type Employee,
  type OnboardingMilestone,
  type OnboardingPlan,
} from "./types";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

const DEFAULT_OBJECTIVES: Readonly<Record<string, string>> = Object.freeze({
  "30-day":
    "Complete onboarding paperwork, meet the team, understand product surface area, ship one small fix.",
  "60-day":
    "Own a small feature end-to-end, run own 1-on-1s with peers, present learnings to the team.",
  "90-day":
    "Take full ownership of one workstream, identify one process improvement, set Q-next goals.",
});

const DEFAULT_CADENCE_DAYS = 14;

export interface OnboardingDraftInput {
  readonly employee: Employee;
  readonly idGen?: () => string;
  readonly clock?: () => Date;
  /** Per-bucket override of the default objective. */
  readonly overrides?: Readonly<Record<string, string>>;
  /** Override the suggested cadence (default 14 days). */
  readonly cadenceDays?: number;
}

/**
 * Draft an immutable 30-60-90 plan for a newly-onboarded employee.
 */
export function draftOnboardingPlan(
  input: OnboardingDraftInput,
): OnboardingPlan {
  const idGen = input.idGen ?? randomUUID;
  const clock = input.clock ?? (() => new Date());
  const start = new Date(input.employee.hireDate).getTime();
  if (!Number.isFinite(start)) {
    throw new Error(
      `onboarding-planner: invalid hireDate '${input.employee.hireDate}'`,
    );
  }
  const buckets = ["30-day", "60-day", "90-day"] as const;
  const milestones: OnboardingMilestone[] = buckets.map((b, i) => {
    const days = (i + 1) * 30;
    const objective =
      input.overrides?.[b] ?? DEFAULT_OBJECTIVES[b] ?? "Onboarding milestone";
    return Object.freeze({
      id: `${input.employee.id}-${b}`,
      bucket: b,
      objective,
      dueAt: new Date(start + days * MS_PER_DAY).toISOString(),
    });
  });

  const plan = {
    id: idGen(),
    tenantId: input.employee.tenantId,
    employeeId: input.employee.id,
    milestones,
    cadenceDays: input.cadenceDays ?? DEFAULT_CADENCE_DAYS,
    createdAt: clock().toISOString(),
  };
  return Object.freeze(onboardingPlanSchema.parse(plan));
}
