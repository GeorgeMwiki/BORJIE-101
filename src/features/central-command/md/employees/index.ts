/**
 * MD Employees — Public API.
 *
 * @module features/central-command/md/employees
 */

export type {
  Employee,
  EmployeeSentiment,
  FeedbackTurn,
  OnboardingMilestone,
  OnboardingPlan,
  SentimentAggregate,
  SentimentEvent,
  SentimentPolarity,
} from "./types";

export {
  employeeSchema,
  employeeSentimentSchema,
  feedbackTurnSchema,
  onboardingMilestoneSchema,
  onboardingPlanSchema,
  sentimentEventSchema,
  sentimentPolaritySchema,
} from "./types";

export {
  aggregateAcrossEmployees,
  aggregateForEmployee,
  extractSentimentEvents,
  type AggregatorInput,
} from "./feedback-aggregator";

export {
  recordOneOnOne,
  suggestOneOnOnes,
  type OneOnOneAnalysisInput,
  type OneOnOneSuggestion,
} from "./one-on-one-tracker";

export {
  draftOnboardingPlan,
  type OnboardingDraftInput,
} from "./onboarding-planner";

export {
  makeEmployeesPersister,
  type EmployeesPersister,
  type EmployeesPersisterConfig,
  type SupabaseLike as EmployeesSupabaseLike,
} from "./persister";

export {
  makeEmployeeService,
  type EmployeeService,
  type EmployeeServiceDeps,
  type IngestFeedbackInput,
  type IngestFeedbackResult,
  type RegisterEmployeeInput,
  type RegisterEmployeeResult,
} from "./employee-service";
