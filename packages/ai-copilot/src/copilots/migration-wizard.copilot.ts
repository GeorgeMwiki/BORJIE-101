/**
 * Migration Wizard Copilot
 *
 * Mirrors MaintenanceTriageCopilot. Wraps the MIGRATION_WIZARD persona
 * with a typed input → typed output flow. The LLM presents a diff review
 * panel and emits a PROPOSED_ACTION when it has a confident bundle; this
 * copilot parses that response and hands off to `skill.migration.commit`
 * via the tool dispatcher.
 */

import {
  CopilotDomain,
  CopilotRequestId,
  RiskLevel,
  AIResult,
  aiOk,
  aiErr,
  CopilotOutputBase,
} from '../types/core.types.js';
import { BaseCopilot, CopilotError } from '../services/base-copilot.js';
import { AICompletionResponse } from '../providers/ai-provider.js';
import { PromptRegistry } from '../prompts/prompt-registry.js';
import { AIProviderRegistry } from '../providers/ai-provider.js';
import { ReviewService } from '../services/review-service.js';

export interface MigrationWizardInput {
  readonly tenantId: string;
  readonly actorId: string;
  readonly runId: string;
  readonly diffSummaryText: string;
  readonly samples: {
    readonly properties: ReadonlyArray<Record<string, unknown>>;
    readonly units: ReadonlyArray<Record<string, unknown>>;
    readonly tenants: ReadonlyArray<Record<string, unknown>>;
    readonly employees: ReadonlyArray<Record<string, unknown>>;
  };
  readonly warnings: readonly string[];
}

export interface MigrationWizardOutput extends CopilotOutputBase {
  readonly requestId: CopilotRequestId;
  readonly proposedAction:
    | { readonly kind: 'commit'; readonly runId: string; readonly risk: RiskLevel }
    | { readonly kind: 'revise'; readonly notes: string }
    | { readonly kind: 'abort'; readonly notes: string };
  readonly narrative: string;
  readonly confidence: number;
}

interface ParsedWizardResponse {
  narrative: string;
  proposedAction: MigrationWizardOutput['proposedAction'];
  confidence?: number;
}

/**
 * NOTE: CopilotDomain here reuses MAINTENANCE_TRIAGE as a temporary tag
 * because the enum does not yet include MIGRATION_WIZARD. A dedicated
 * domain constant is added in a follow-up refactor; using a consistent
 * placeholder avoids a cross-package enum change in this scaffold.
 */
const MIGRATION_DOMAIN_TAG = CopilotDomain.MAINTENANCE_TRIAGE;

export class MigrationWizardCopilot extends BaseCopilot<
  MigrationWizardInput,
  MigrationWizardOutput
> {
  readonly domain = MIGRATION_DOMAIN_TAG;
  readonly promptName = 'migration-wizard-standard';
  readonly defaultRiskLevel = RiskLevel.HIGH;

  constructor(
    promptRegistry: PromptRegistry,
    providerRegistry: AIProviderRegistry,
    reviewService: ReviewService
  ) {
    super(promptRegistry, providerRegistry, reviewService);
  }

  protected transformInputToVariables(
    input: MigrationWizardInput
  ): Record<string, unknown> {
    return {
      tenantId: input.tenantId,
      runId: input.runId,
      diffSummaryText: input.diffSummaryText,
      samples: input.samples,
      warnings: input.warnings,
    };
  }

  protected parseAIResponse(
    response: AICompletionResponse,
    _input: MigrationWizardInput,
    requestId: CopilotRequestId
  ): AIResult<MigrationWizardOutput, CopilotError> {
    const parsed = this.safeParseJson<ParsedWizardResponse>(
      response.content,
      requestId
    );
    if (!parsed.success) {
      return parsed as AIResult<MigrationWizardOutput, CopilotError>;
    }

    const proposed = parsed.data.proposedAction;
    if (
      !proposed ||
      (proposed.kind !== 'commit' &&
        proposed.kind !== 'revise' &&
        proposed.kind !== 'abort')
    ) {
      return aiErr({
        code: 'VALIDATION_ERROR',
        message: 'Missing/invalid proposedAction in wizard response',
        domain: this.domain,
        retryable: false,
      });
    }

    const riskLevel =
      proposed.kind === 'commit' ? RiskLevel.HIGH : RiskLevel.MEDIUM;

    const output: MigrationWizardOutput = {
      ...(this.createBaseOutput(requestId, riskLevel) as MigrationWizardOutput),
      requestId,
      domain: MIGRATION_DOMAIN_TAG,
      riskLevel,
      proposedAction: proposed,
      narrative: parsed.data.narrative ?? '',
      confidence: parsed.data.confidence ?? 0.7,
    };
    return aiOk(output);
  }

  protected calculateConfidence(output: MigrationWizardOutput): number {
    return output.confidence;
  }

  protected validateOutput(
    output: MigrationWizardOutput
  ): AIResult<MigrationWizardOutput, CopilotError> {
    if (!output.narrative) {
      return aiErr({
        code: 'VALIDATION_ERROR',
        message: 'Wizard narrative is required',
        domain: this.domain,
        retryable: false,
      });
    }
    return aiOk(output);
  }
}

export function createMigrationWizardCopilot(
  promptRegistry: PromptRegistry,
  providerRegistry: AIProviderRegistry,
  reviewService: ReviewService
): MigrationWizardCopilot {
  return new MigrationWizardCopilot(
    promptRegistry,
    providerRegistry,
    reviewService
  );
}
