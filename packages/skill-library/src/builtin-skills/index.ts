/**
 * @borjie/skill-library/builtin-skills — 6 mining-estate operations skills.
 *
 * These are *seed* skills shipped with the library. Tenants can extend
 * them with their own SKILL.md directories in
 * `tenants/<tenantId>/skills/` and the library will discover them
 * alongside these.
 */

export { handleLateRoyaltySkill, computeStep, type HandleLateRoyaltyInput, type HandleLateRoyaltyOutput, type LateRoyaltyStep } from './handle-late-royalty/handle-late-royalty.skill.js';
export { compileWeeklyReportSkill, type CompileWeeklyReportInput, type CompileWeeklyReportOutput, type WeeklyReportSignals } from './compile-weekly-report/compile-weekly-report.skill.js';
export { dispatchMaintenanceSkill, scoreVendor, rankVendorCandidates, slaForSeverity, type DispatchMaintenanceInput, type DispatchMaintenanceOutput, type Severity, type CandidateVendor, type VendorScore } from './dispatch-maintenance/dispatch-maintenance.skill.js';
export { onboardCounterpartySkill, nextStep, type OnboardCounterpartyInput, type OnboardCounterpartyOutput, type OnboardStep } from './onboard-counterparty/onboard-counterparty.skill.js';
export { chaseOutstandingRoyaltiesSkill, chooseAction, type ChaseOutstandingRoyaltiesInput, type ChaseOutstandingRoyaltiesOutput, type OutstandingRoyaltyAction, type OutstandingRoyaltyRow } from './chase-outstanding-royalties/chase-outstanding-royalties.skill.js';
export {
  prepareTraFilingSkill,
  JurisdictionMismatchError,
  type PrepareTraFilingInput,
  type PrepareTraFilingOutput,
  type TraPayment,
} from './prepare-tra-filing/prepare-tra-filing.skill.js';

export { embed } from './embed.js';

import type { CodeSkill } from '../voyager-library/index.js';
import { handleLateRoyaltySkill } from './handle-late-royalty/handle-late-royalty.skill.js';
import { compileWeeklyReportSkill } from './compile-weekly-report/compile-weekly-report.skill.js';
import { dispatchMaintenanceSkill } from './dispatch-maintenance/dispatch-maintenance.skill.js';
import { onboardCounterpartySkill } from './onboard-counterparty/onboard-counterparty.skill.js';
import { chaseOutstandingRoyaltiesSkill } from './chase-outstanding-royalties/chase-outstanding-royalties.skill.js';
import { prepareTraFilingSkill } from './prepare-tra-filing/prepare-tra-filing.skill.js';

/**
 * Bundle helper: all 6 built-in skills as an array, ready to be registered
 * into a VoyagerSkillLibrary in one call.
 *
 *   const lib = new VoyagerSkillLibrary();
 *   for (const s of BUILTIN_SKILLS) lib.register(s);
 */
export const BUILTIN_SKILLS: ReadonlyArray<CodeSkill> = [
  handleLateRoyaltySkill as unknown as CodeSkill,
  compileWeeklyReportSkill as unknown as CodeSkill,
  dispatchMaintenanceSkill as unknown as CodeSkill,
  onboardCounterpartySkill as unknown as CodeSkill,
  chaseOutstandingRoyaltiesSkill as unknown as CodeSkill,
  prepareTraFilingSkill as unknown as CodeSkill,
];
