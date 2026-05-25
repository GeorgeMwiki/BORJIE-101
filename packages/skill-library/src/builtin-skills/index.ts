/**
 * @borjie/skill-library/builtin-skills — 6 property-management skills.
 *
 * These are *seed* skills shipped with the library. Tenants can extend
 * them with their own SKILL.md directories in
 * `tenants/<tenantId>/skills/` and the library will discover them
 * alongside these.
 */

export { handleLateRentSkill, computeStep, type HandleLateRentInput, type HandleLateRentOutput, type LateRentStep } from './handle-late-rent/handle-late-rent.skill.js';
export { compileWeeklyReportSkill, type CompileWeeklyReportInput, type CompileWeeklyReportOutput, type WeeklyReportSignals } from './compile-weekly-report/compile-weekly-report.skill.js';
export { dispatchMaintenanceSkill, scoreVendor, rankVendorCandidates, slaForSeverity, type DispatchMaintenanceInput, type DispatchMaintenanceOutput, type Severity, type CandidateVendor, type VendorScore } from './dispatch-maintenance/dispatch-maintenance.skill.js';
export { onboardTenantSkill, nextStep, type OnboardTenantInput, type OnboardTenantOutput, type OnboardStep } from './onboard-tenant/onboard-tenant.skill.js';
export { chaseArrearsSkill, chooseAction, type ChaseArrearsInput, type ChaseArrearsOutput, type ArrearsAction, type ArrearsRow } from './chase-arrears/chase-arrears.skill.js';
export {
  prepareKraFilingSkill,
  JurisdictionMismatchError,
  type PrepareKraFilingInput,
  type PrepareKraFilingOutput,
  type KraPayment,
} from './prepare-kra-filing/prepare-kra-filing.skill.js';

export { embed } from './embed.js';

import type { CodeSkill } from '../voyager-library/index.js';
import { handleLateRentSkill } from './handle-late-rent/handle-late-rent.skill.js';
import { compileWeeklyReportSkill } from './compile-weekly-report/compile-weekly-report.skill.js';
import { dispatchMaintenanceSkill } from './dispatch-maintenance/dispatch-maintenance.skill.js';
import { onboardTenantSkill } from './onboard-tenant/onboard-tenant.skill.js';
import { chaseArrearsSkill } from './chase-arrears/chase-arrears.skill.js';
import { prepareKraFilingSkill } from './prepare-kra-filing/prepare-kra-filing.skill.js';

/**
 * Bundle helper: all 6 built-in skills as an array, ready to be registered
 * into a VoyagerSkillLibrary in one call.
 *
 *   const lib = new VoyagerSkillLibrary();
 *   for (const s of BUILTIN_SKILLS) lib.register(s);
 */
export const BUILTIN_SKILLS: ReadonlyArray<CodeSkill> = [
  handleLateRentSkill as unknown as CodeSkill,
  compileWeeklyReportSkill as unknown as CodeSkill,
  dispatchMaintenanceSkill as unknown as CodeSkill,
  onboardTenantSkill as unknown as CodeSkill,
  chaseArrearsSkill as unknown as CodeSkill,
  prepareKraFilingSkill as unknown as CodeSkill,
];
