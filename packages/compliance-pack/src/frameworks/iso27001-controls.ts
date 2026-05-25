/**
 * ISO/IEC 27001:2022 — Annex A controls.
 *
 * The 2022 edition restructures Annex A into 4 themes:
 *   A.5  Organizational controls (37)
 *   A.6  People controls (8)
 *   A.7  Physical controls (14)
 *   A.8  Technological controls (34)
 *
 * Total 93 controls. We expose a representative subset that the
 * platform directly satisfies — full Annex A is not the goal here;
 * the goal is a programmatic registry consumers can query.
 *
 * Reference: https://en.wikipedia.org/wiki/ISO/IEC_27001 +
 * the official ISO/IEC 27001:2022 standard.
 */

import type { ControlCatalog } from '../types.js';

export const iso27001Catalog: ControlCatalog = {
  frameworkId: 'iso27001',
  displayName: 'ISO/IEC 27001:2022 (Annex A)',
  version: '2022',
  jurisdiction: 'GLOBAL',
  controls: [
    {
      id: 'A.5.1',
      name: 'Policies for information security',
      description:
        'Information security policy and topic-specific policies shall be ' +
        'defined, approved, published, and communicated.',
      jurisdiction: 'GLOBAL',
      satisfiedBy: ['Docs/COMPLIANCE/README.md', 'SECURITY.md'],
    },
    {
      id: 'A.5.7',
      name: 'Threat intelligence',
      description:
        'Information related to information security threats shall be ' +
        'collected and analysed to produce threat intelligence.',
      jurisdiction: 'GLOBAL',
      satisfiedBy: ['packages/security-audit', '.github/workflows/security-monitoring.yml'],
    },
    {
      id: 'A.5.23',
      name: 'Information security for use of cloud services',
      description:
        'Acquisition, use, management, and exit of cloud services shall ' +
        'be in accordance with information security requirements.',
      jurisdiction: 'GLOBAL',
      satisfiedBy: [
        'packages/compliance-pack/src/residency',
        'infra/cloud-config',
      ],
    },
    {
      id: 'A.5.30',
      name: 'ICT readiness for business continuity',
      description:
        'ICT readiness shall be planned, implemented, maintained, and ' +
        'tested based on business continuity objectives.',
      jurisdiction: 'GLOBAL',
      satisfiedBy: ['Docs/RUNBOOKS/disaster-recovery.md'],
    },
    {
      id: 'A.5.34',
      name: 'Privacy and protection of PII',
      description:
        'The organisation shall identify and meet requirements regarding ' +
        'the preservation of privacy and protection of PII.',
      jurisdiction: 'GLOBAL',
      satisfiedBy: [
        'packages/compliance-pack/src/dsar',
        'packages/compliance-pack/src/erasure-cascade',
      ],
    },
    {
      id: 'A.6.3',
      name: 'Information security awareness, education, training',
      description:
        'Personnel shall receive appropriate information security ' +
        'awareness training and regular updates.',
      jurisdiction: 'GLOBAL',
      satisfiedBy: ['hr/security-training-program'],
    },
    {
      id: 'A.6.6',
      name: 'Confidentiality / non-disclosure agreements',
      description:
        'Confidentiality agreements reflecting the needs for protection ' +
        'of information shall be identified and regularly reviewed.',
      jurisdiction: 'GLOBAL',
      satisfiedBy: ['hr/nda-templates', 'Docs/LEGAL.md'],
    },
    {
      id: 'A.7.4',
      name: 'Physical security monitoring',
      description:
        'Premises shall be continuously monitored for unauthorised ' +
        'physical access.',
      jurisdiction: 'GLOBAL',
      satisfiedBy: ['facilities/access-control'],
    },
    {
      id: 'A.8.2',
      name: 'Privileged access rights',
      description:
        'The allocation and use of privileged access rights shall be ' +
        'restricted and managed.',
      jurisdiction: 'GLOBAL',
      satisfiedBy: ['packages/authz-policy', 'packages/database/src/services/rls-policies'],
    },
    {
      id: 'A.8.10',
      name: 'Information deletion',
      description:
        'Information stored in information systems shall be deleted when ' +
        'no longer required.',
      jurisdiction: 'GLOBAL',
      satisfiedBy: ['packages/compliance-pack/src/erasure-cascade'],
    },
    {
      id: 'A.8.11',
      name: 'Data masking',
      description:
        'Data masking shall be used in accordance with the policy on the ' +
        'use of cryptography.',
      jurisdiction: 'GLOBAL',
      satisfiedBy: [
        'packages/compliance-pack/src/encryption',
        'packages/graph-privacy',
      ],
    },
    {
      id: 'A.8.12',
      name: 'Data leakage prevention',
      description:
        'Data leakage prevention measures shall be applied to systems, ' +
        'networks, and devices that process, store, or transmit sensitive ' +
        'information.',
      jurisdiction: 'GLOBAL',
      satisfiedBy: ['packages/security-audit'],
    },
    {
      id: 'A.8.15',
      name: 'Logging',
      description:
        'Logs recording activities, exceptions, faults, and security ' +
        'events shall be produced, stored, protected, and analysed.',
      jurisdiction: 'GLOBAL',
      satisfiedBy: [
        'packages/observability/src/logger.ts',
        'packages/ai-copilot/src/security/audit-hash-chain.ts',
      ],
    },
    {
      id: 'A.8.24',
      name: 'Use of cryptography',
      description:
        'Rules for the effective use of cryptography, including ' +
        'cryptographic key management, shall be defined and implemented.',
      jurisdiction: 'GLOBAL',
      satisfiedBy: ['packages/compliance-pack/src/encryption'],
    },
    {
      id: 'A.8.34',
      name: 'Protection of information systems during audit testing',
      description:
        'Audit tests and other assurance activities shall be planned and ' +
        'agreed to minimise disruptions.',
      jurisdiction: 'GLOBAL',
      satisfiedBy: ['Docs/RUNBOOKS/audit-window-procedure.md'],
    },
  ],
};
