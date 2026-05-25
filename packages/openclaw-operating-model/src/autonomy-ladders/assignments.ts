/**
 * `assignAutonomyLevel` — records a per-(agent, domain, [tenant]) level
 * change to the audit log via the supplied AgentRegistry port.
 *
 * The caller is responsible for downstream consumers (e.g. kill-switch
 * checks, policy refresh). This module deliberately exposes only the
 * registry call + an audit envelope.
 */

import type {
  AgentRegistry,
  AutonomyLevel,
  Jurisdiction,
  JurisdictionAutonomyCap,
  RiskClass,
} from '../types.js';
import { applyJurisdictionCap } from './ladders.js';

export interface AssignAutonomyLevelArgs {
  readonly agentId: string;
  readonly domainId: string;
  readonly tenantId?: string;
  readonly requestedLevel: AutonomyLevel;
  readonly jurisdiction: Jurisdiction;
  readonly riskClass: RiskClass;
  readonly justification: string;
  readonly setBy: string;
  readonly caps?: ReadonlyArray<JurisdictionAutonomyCap>;
}

export interface AssignAutonomyLevelResult {
  readonly effectiveLevel: AutonomyLevel;
  readonly requestedLevel: AutonomyLevel;
  readonly capApplied: JurisdictionAutonomyCap | null;
  readonly justification: string;
  readonly setBy: string;
  readonly recordedAt: string;
}

export async function assignAutonomyLevel(args: {
  readonly registry: AgentRegistry;
  readonly input: AssignAutonomyLevelArgs;
  readonly now?: () => Date;
}): Promise<AssignAutonomyLevelResult> {
  const { registry, input } = args;
  const now = (args.now ?? (() => new Date()))();

  if (!input.justification || input.justification.trim().length < 8) {
    throw new Error(
      'assignAutonomyLevel: justification must be at least 8 characters (regulator-grade audit requirement)',
    );
  }

  const capResult = applyJurisdictionCap({
    requested: input.requestedLevel,
    jurisdiction: input.jurisdiction,
    riskClass: input.riskClass,
    ...(input.caps !== undefined && { caps: input.caps }),
  });

  await registry.setAutonomyLevel({
    agentId: input.agentId,
    domainId: input.domainId,
    ...(input.tenantId !== undefined && { tenantId: input.tenantId }),
    level: capResult.effective,
    justification: input.justification,
    setBy: input.setBy,
  });

  return {
    effectiveLevel: capResult.effective,
    requestedLevel: capResult.requested,
    capApplied: capResult.capApplied,
    justification: input.justification,
    setBy: input.setBy,
    recordedAt: now.toISOString(),
  };
}
