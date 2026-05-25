/**
 * TCFD-aligned disclosure narrative renderer.
 *
 * The TCFD recommendations sunset 2023 — disclosures rolled to IFRS
 * S1/S2 (see ifrs-s2-renderer). We keep this renderer because many
 * jurisdictions (HK, JP, NZ pre-XRB-S2) still report against TCFD,
 * and the four-pillar narrative shape is reused inside IFRS S2.
 */

import type { CarbonReport, TcfdNarrative } from '../types.js';

export interface TcfdInputs {
  readonly entityName: string;
  readonly carbon: CarbonReport;
  readonly hasBoardOversight: boolean;
  readonly hasManagementCommittee: boolean;
  readonly scenarios: ReadonlyArray<string>;
  readonly hasTransitionPlan: boolean;
  readonly internalCarbonPricePerTonne: number | null;
  readonly physicalRisksMaterial: ReadonlyArray<string>;
  readonly transitionRisksMaterial: ReadonlyArray<string>;
  readonly targetsKgCO2ePerM2: number | null;
  readonly targetYear: number | null;
}

export function renderTcfdNarrative(i: TcfdInputs): TcfdNarrative {
  const totalT = (i.carbon.totalOperationalKgCO2e / 1000).toFixed(1);
  const intensity = i.carbon.intensityKgCO2ePerM2.toFixed(2);

  const governance = [
    `${i.entityName} climate governance:`,
    i.hasBoardOversight
      ? '- Board-level oversight: yes; climate is a standing agenda item.'
      : '- Board-level oversight: NOT in place — gap to remediate before FY27 assurance.',
    i.hasManagementCommittee
      ? '- Management climate-risk committee: convened ≥quarterly with CRO + Head of ESG.'
      : '- No formal management committee; risk currently sits with the COO.',
  ].join('\n');

  const strategy = [
    `Scenarios analysed: ${i.scenarios.length > 0 ? i.scenarios.join(', ') : 'none filed'}.`,
    `Transition plan: ${i.hasTransitionPlan ? 'published, with capex pathway to 2050.' : 'NOT published — required by FY26 for UK SDR.'}`,
    `Internal carbon price: ${i.internalCarbonPricePerTonne !== null
      ? `$${i.internalCarbonPricePerTonne}/tCO2e used in NPV gating.`
      : 'not yet adopted.'}`,
    `Material physical risks: ${i.physicalRisksMaterial.join('; ') || 'none yet identified'}.`,
    `Material transition risks: ${i.transitionRisksMaterial.join('; ') || 'none yet identified'}.`,
  ].join('\n');

  const riskManagement = [
    'Climate risks integrated into the enterprise risk framework:',
    '- Risks scored on inherent and residual basis, residual reviewed semi-annually.',
    '- Each material risk has a named owner at director level.',
    '- Aggregate physical risk mapped to the asset register via geo-spatial overlay.',
  ].join('\n');

  const metricsAndTargets = [
    `Reporting period: ${i.carbon.period.financialYear}.`,
    `Total operational emissions: ${totalT} tCO2e (S1+S2 market + S3 where applicable).`,
    `Intensity: ${intensity} kgCO2e/m² GIA.`,
    i.targetsKgCO2ePerM2 !== null && i.targetYear !== null
      ? `Target: ≤${i.targetsKgCO2ePerM2} kgCO2e/m² by ${i.targetYear}.`
      : 'No quantified intensity target published.',
  ].join('\n');

  return {
    governance,
    strategy,
    riskManagement,
    metricsAndTargets,
  };
}
