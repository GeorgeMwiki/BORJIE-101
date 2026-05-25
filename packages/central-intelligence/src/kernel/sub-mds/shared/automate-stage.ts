/**
 * AUTOMATE stage primitive — compiles a redesign proposal into a
 * concrete AutomationArtifact (skill + cron + monitor thresholds +
 * hook list).
 *
 * The artefact is ALWAYS produced in `draft` state. The MD's
 * four-eye approval flow (kernel/four-eye-approval.ts) decides
 * whether to promote it. A sub-MD never auto-promotes.
 */

import type {
  AutomationArtifact,
  RedesignProposal,
  SubMdBudget,
} from './sub-md-base.js';

export interface AutomateStageArgs {
  readonly proposal: RedesignProposal;
  readonly skillNamespace: string;
  readonly cronExpression?: string;
  readonly monitorThresholds: Readonly<Record<string, number>>;
  readonly hookNames: ReadonlyArray<string>;
  readonly budget: SubMdBudget;
}

export function runAutomateStage(args: AutomateStageArgs): AutomationArtifact {
  if (args.budget.maxAutomationArtifacts < 1) {
    return Object.freeze({
      skillName: `${args.skillNamespace}.no-op`,
      monitorThresholds: Object.freeze({ ...args.monitorThresholds }),
      hookNames: Object.freeze(args.hookNames.slice()),
      draftStatus: 'draft',
    });
  }
  const stepSlug =
    args.proposal.steps[0]?.id?.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 32) ?? 'proposal';
  const skillName = `${args.skillNamespace}.${stepSlug}`;
  const artifact: AutomationArtifact = args.cronExpression !== undefined
    ? {
        skillName,
        cronExpression: args.cronExpression,
        monitorThresholds: Object.freeze({ ...args.monitorThresholds }),
        hookNames: Object.freeze(args.hookNames.slice()),
        draftStatus: 'review-requested',
      }
    : {
        skillName,
        monitorThresholds: Object.freeze({ ...args.monitorThresholds }),
        hookNames: Object.freeze(args.hookNames.slice()),
        draftStatus: 'review-requested',
      };
  return Object.freeze(artifact);
}
