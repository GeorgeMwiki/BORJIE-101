/**
 * SOC 2 Type II — AICPA Trust Services Criteria (2017, rev 2022).
 *
 * We model the Common Criteria CC1–CC9 plus the four supplementary
 * categories (Availability A1, Processing Integrity PI1, Confidentiality
 * C1, Privacy P1). Each control lists the platform features that
 * satisfy it; auditors retrieve evidence by following `satisfiedBy`
 * paths into the repo.
 *
 * Reference: https://en.wikipedia.org/wiki/SOC_2 +
 * Docs/COMPLIANCE/SOC2_CONTROLS.md (operator runbook).
 */

import type { ControlCatalog } from '../types.js';

export const soc2Catalog: ControlCatalog = {
  frameworkId: 'soc2',
  displayName: 'SOC 2 Type II (AICPA TSC 2017, rev 2022)',
  version: '2022',
  jurisdiction: 'GLOBAL',
  controls: [
    {
      id: 'CC1.1',
      name: 'COSO integrity & ethics',
      description:
        'Demonstrates commitment to integrity and ethical values through ' +
        'code of conduct, tone-at-the-top, and background checks.',
      jurisdiction: 'GLOBAL',
      satisfiedBy: ['Docs/LEGAL.md', 'hr/background-checks'],
    },
    {
      id: 'CC2.1',
      name: 'Information requirements',
      description:
        'Internal communication of objectives and responsibilities. ' +
        'Logs are captured, retained, and tamper-evident.',
      jurisdiction: 'GLOBAL',
      satisfiedBy: [
        'packages/observability/src/logger.ts',
        'packages/ai-copilot/src/security/audit-hash-chain.ts',
      ],
    },
    {
      id: 'CC3.1',
      name: 'Risk identification & analysis',
      description:
        'Specifies suitable objectives and identifies risks to the ' +
        'achievement of those objectives.',
      jurisdiction: 'GLOBAL',
      satisfiedBy: ['Docs/RISK_REGISTER.md', 'Docs/RUNBOOKS/incident-response.md'],
    },
    {
      id: 'CC4.1',
      name: 'Ongoing & separate evaluations',
      description:
        'Selects, develops, and performs ongoing evaluations to ascertain ' +
        'whether components of internal control are functioning.',
      jurisdiction: 'GLOBAL',
      satisfiedBy: [
        '.github/workflows/security-monitoring.yml',
        'packages/observability',
      ],
    },
    {
      id: 'CC5.1',
      name: 'Selection & development of controls',
      description:
        'Selects and develops control activities that contribute to the ' +
        'mitigation of risks to acceptable levels.',
      jurisdiction: 'GLOBAL',
      satisfiedBy: ['packages/authz-policy', 'packages/compliance-pack'],
    },
    {
      id: 'CC6.1',
      name: 'Logical access controls',
      description:
        'Implements logical access security software, infrastructure, and ' +
        'architectures over protected information assets.',
      jurisdiction: 'GLOBAL',
      satisfiedBy: [
        'packages/authz-policy',
        'packages/database/src/services/rls-policies',
      ],
    },
    {
      id: 'CC6.6',
      name: 'Encryption of confidential data in transit',
      description:
        'Implements logical access controls and encryption for data in ' +
        'transit and at rest.',
      jurisdiction: 'GLOBAL',
      satisfiedBy: [
        'packages/compliance-pack/src/encryption',
        'infra/tls-config',
      ],
    },
    {
      id: 'CC7.1',
      name: 'System operations / monitoring of vulnerabilities',
      description:
        'Detects and monitors changes to configurations that could ' +
        'introduce new vulnerabilities.',
      jurisdiction: 'GLOBAL',
      satisfiedBy: [
        '.github/workflows/security-monitoring.yml',
        'packages/security-audit',
      ],
    },
    {
      id: 'CC7.2',
      name: 'Incident response',
      description:
        'Monitors system components for anomalies and responds to ' +
        'identified security events.',
      jurisdiction: 'GLOBAL',
      satisfiedBy: [
        'packages/compliance-pack/src/breach',
        'Docs/COMPLIANCE/breach-notification-runbook.md',
      ],
    },
    {
      id: 'CC8.1',
      name: 'Change management',
      description:
        'Authorizes, designs, develops, and configures changes to system ' +
        'components.',
      jurisdiction: 'GLOBAL',
      satisfiedBy: ['.github/workflows/ci.yml', 'Docs/RUNBOOKS/migration-production.md'],
    },
    {
      id: 'CC9.1',
      name: 'Risk mitigation activities (business continuity)',
      description:
        'Identifies, selects, and develops risk mitigation activities for ' +
        'risks arising from potential business disruptions.',
      jurisdiction: 'GLOBAL',
      satisfiedBy: ['Docs/RUNBOOKS/disaster-recovery.md'],
    },
    {
      id: 'A1.1',
      name: 'Availability — capacity planning',
      description:
        'Monitors current processing capacity and use of system components ' +
        'and authorizes additional capacity.',
      jurisdiction: 'GLOBAL',
      satisfiedBy: ['monitoring/prometheus-rules', 'k8s/hpa'],
    },
    {
      id: 'PI1.1',
      name: 'Processing integrity — inputs are complete and accurate',
      description:
        'Implements policies and procedures over inputs to result in ' +
        'completeness, accuracy, and timeliness.',
      jurisdiction: 'GLOBAL',
      satisfiedBy: [
        'packages/api-sdk/src/validators',
        'packages/domain-models',
      ],
    },
    {
      id: 'C1.1',
      name: 'Confidentiality — information identified and protected',
      description:
        'Identifies and maintains confidential information to meet the ' +
        "entity's objectives related to confidentiality.",
      jurisdiction: 'GLOBAL',
      satisfiedBy: ['packages/compliance-pack/src/encryption'],
    },
    {
      id: 'P1.1',
      name: 'Privacy — notice and choice',
      description:
        'Provides notice about its privacy practices to data subjects and ' +
        'obtains consent before collecting personal information.',
      jurisdiction: 'GLOBAL',
      satisfiedBy: [
        'packages/compliance-plugins',
        'Docs/COMPLIANCE/consent-revocation-runbook.md',
      ],
    },
  ],
};
