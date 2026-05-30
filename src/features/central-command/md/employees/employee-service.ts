/**
 * Employees — Public Service API
 *
 * Composes the persister, the feedback aggregator, the 1-on-1 tracker,
 * the onboarding planner, and tier-policy guards.
 *
 * @module features/central-command/md/employees/employee-service
 */

import { randomUUID } from "node:crypto";

import { createLogger } from "@/lib/logger";
import { startTrace, type TraceStore } from "@/core/borjie-ai/decision-trace";
import {
  assertTierPolicy,
  type BorjieAITier,
} from "@/core/governance/tier-policy";
import {
  aggregateAcrossEmployees,
  aggregateForEmployee,
  extractSentimentEvents,
} from "./feedback-aggregator";
import {
  recordOneOnOne,
  suggestOneOnOnes,
  type OneOnOneSuggestion,
} from "./one-on-one-tracker";
import { draftOnboardingPlan } from "./onboarding-planner";
import type { EmployeesPersister } from "./persister";
import type {
  Employee,
  EmployeeSentiment,
  FeedbackTurn,
  OnboardingPlan,
  SentimentAggregate,
  SentimentEvent,
} from "./types";

const log = createLogger("md.employees.service");

export interface EmployeeServiceDeps {
  readonly persister: EmployeesPersister;
  readonly traceStore: TraceStore;
  readonly idGen?: () => string;
  readonly clock?: () => Date;
}

export interface RegisterEmployeeInput {
  readonly tier: BorjieAITier;
  readonly sessionId: string;
  readonly correlationId: string;
  readonly userId: string;
  readonly employee: Employee;
  readonly autoPlanOnboarding?: boolean;
}

export interface RegisterEmployeeResult {
  readonly employee: Employee;
  readonly plan: OnboardingPlan | null;
  readonly traceId: string;
}

export interface IngestFeedbackInput {
  readonly tier: BorjieAITier;
  readonly sessionId: string;
  readonly correlationId: string;
  readonly userId: string;
  readonly turn: FeedbackTurn;
  readonly employees: ReadonlyArray<Employee>;
}

export interface IngestFeedbackResult {
  readonly events: ReadonlyArray<SentimentEvent>;
  readonly aggregates: ReadonlyArray<SentimentAggregate>;
  readonly traceId: string;
}

export interface EmployeeService {
  registerEmployee(
    input: RegisterEmployeeInput,
  ): Promise<RegisterEmployeeResult>;
  ingestFeedback(input: IngestFeedbackInput): Promise<IngestFeedbackResult>;
  recordOneOnOne(
    tier: BorjieAITier,
    employee: Employee,
    at: Date,
  ): Promise<Employee>;
  suggestOneOnOnes(
    tenantId: string,
    now: Date,
  ): Promise<ReadonlyArray<OneOnOneSuggestion>>;
  aggregateSentiment(
    employeeId: string,
    events: ReadonlyArray<SentimentEvent>,
    now: Date,
  ): SentimentAggregate;
}

export function makeEmployeeService(
  deps: EmployeeServiceDeps,
): EmployeeService {
  const idGen = deps.idGen ?? randomUUID;
  const clock = deps.clock ?? (() => new Date());

  return Object.freeze({
    async registerEmployee(
      input: RegisterEmployeeInput,
    ): Promise<RegisterEmployeeResult> {
      assertWrite(input.tier);
      const recorder = startTrace({
        correlationId: input.correlationId,
        sessionId: input.sessionId,
        userId: input.userId,
        tier: input.tier,
        model: "md.employees.register",
        modelTier: "haiku",
        input: {
          text: `register employee ${input.employee.name}`,
          portalId: "central-command.md",
          route: "employees/register",
        },
      });

      await deps.persister.upsertEmployee(input.employee);
      recorder.addReasoning("employee persisted");

      let plan: OnboardingPlan | null = null;
      if (input.autoPlanOnboarding !== false) {
        plan = draftOnboardingPlan({
          employee: input.employee,
          idGen,
          clock,
        });
        await deps.persister.upsertPlan(plan);
        recorder.useTool({
          name: "onboarding.draft",
          input: { employeeId: input.employee.id },
          output: { milestones: plan.milestones.length },
          latencyMs: 0,
        });
      }

      const trace = await recorder.finalize(
        {
          type: "md.employees.register",
          target: input.employee.id,
          payload: {
            planned: plan !== null,
            milestones: plan?.milestones.length ?? 0,
          },
        },
        deps.traceStore,
      );

      log.info("employee registered", {
        id: input.employee.id,
        planned: plan !== null,
      });

      return Object.freeze({
        employee: input.employee,
        plan,
        traceId: trace.id,
      });
    },

    async ingestFeedback(
      input: IngestFeedbackInput,
    ): Promise<IngestFeedbackResult> {
      assertWrite(input.tier);
      const recorder = startTrace({
        correlationId: input.correlationId,
        sessionId: input.sessionId,
        userId: input.userId,
        tier: input.tier,
        model: "md.employees.feedback",
        modelTier: "haiku",
        input: {
          text: input.turn.text,
          portalId: "central-command.md",
          route: "employees/feedback",
        },
      });

      const start = Date.now();
      const events = extractSentimentEvents({
        turn: input.turn,
        employees: input.employees,
        idGen,
      });
      recorder.useTool({
        name: "feedback.extract",
        input: { turnId: input.turn.turnId },
        output: { count: events.length },
        latencyMs: Date.now() - start,
      });

      if (events.length > 0) {
        await deps.persister.recordSentimentEvents(events);
        // Refresh per-employee sentiment classification on the parent
        // record so listEmployees() reflects the trend.
        const aggregates = aggregateAcrossEmployees(events, clock());
        const refreshed: Employee[] = [];
        for (const agg of aggregates) {
          const e = input.employees.find((x) => x.id === agg.employeeId);
          if (!e) continue;
          refreshed.push(
            Object.freeze<Employee>({
              ...e,
              sentiment: agg.classification satisfies EmployeeSentiment,
              feedbackReceivedAt: clock().toISOString(),
            }),
          );
        }
        if (refreshed.length > 0) {
          await deps.persister.upsertEmployees(refreshed);
        }
        recorder.addReasoning(
          `${events.length} sentiment event(s); ${refreshed.length} aggregate refresh(es)`,
        );
        const trace = await recorder.finalize(
          {
            type: "md.employees.feedback",
            target: input.turn.turnId,
            payload: { eventCount: events.length },
          },
          deps.traceStore,
        );
        return Object.freeze({
          events,
          aggregates,
          traceId: trace.id,
        });
      }

      const trace = await recorder.finalize(
        {
          type: "md.employees.feedback",
          target: input.turn.turnId,
          payload: { eventCount: 0 },
        },
        deps.traceStore,
      );
      return Object.freeze({
        events: Object.freeze([]),
        aggregates: Object.freeze([]),
        traceId: trace.id,
      });
    },

    async recordOneOnOne(
      tier: BorjieAITier,
      employee: Employee,
      at: Date,
    ): Promise<Employee> {
      assertWrite(tier);
      const next = recordOneOnOne(employee, at);
      await deps.persister.upsertEmployee(next);
      return next;
    },

    async suggestOneOnOnes(
      tenantId: string,
      now: Date,
    ): Promise<ReadonlyArray<OneOnOneSuggestion>> {
      const employees = await deps.persister.listEmployees(tenantId);
      return suggestOneOnOnes({ employees, now });
    },

    aggregateSentiment(
      employeeId: string,
      events: ReadonlyArray<SentimentEvent>,
      now: Date,
    ): SentimentAggregate {
      return aggregateForEmployee(employeeId, events, now);
    },
  });
}

function assertWrite(tier: BorjieAITier): void {
  const r = assertTierPolicy(tier, "chat:converse");
  if (!r.ok) {
    throw new Error(`md.employees: tier ${tier} forbidden (${r.reason})`);
  }
}
