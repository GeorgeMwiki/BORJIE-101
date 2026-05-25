/**
 * POPIA — South Africa Protection of Personal Information Act
 * (Act 4 of 2013, enforced 1 July 2021).
 *
 * Eight conditions for lawful processing + the operational sections
 * 18–22 (notification, security safeguards, operator processing, breach).
 *
 * Reference: https://popia.co.za/ and the
 * Information Regulator (South Africa).
 */

import type { ControlCatalog } from '../types.js';

export const popiaCatalog: ControlCatalog = {
  frameworkId: 'popia',
  displayName: 'POPIA — Protection of Personal Information Act (Act 4 of 2013)',
  version: '2013-Act-4',
  jurisdiction: 'ZA',
  controls: [
    {
      id: 'S8.Accountability',
      name: 'Condition 1 — Accountability',
      description:
        'Responsible party must ensure conditions for lawful processing ' +
        'are complied with at the time of determining purpose and means.',
      jurisdiction: 'ZA',
      satisfiedBy: ['Docs/COMPLIANCE/DPA_TEMPLATE.md'],
    },
    {
      id: 'S9.ProcessingLimitation',
      name: 'Condition 2 — Processing limitation',
      description:
        'Processing must be lawful, in a reasonable manner, and minimal — ' +
        'collected only for a specific, explicitly defined, lawful purpose.',
      jurisdiction: 'ZA',
      satisfiedBy: ['packages/authz-policy', 'Docs/COMPLIANCE/lawful-basis-register.json'],
    },
    {
      id: 'S13.PurposeSpec',
      name: 'Condition 3 — Purpose specification',
      description:
        'Personal information must be collected for specific, explicitly ' +
        'defined and lawful purpose related to a function or activity.',
      jurisdiction: 'ZA',
      satisfiedBy: ['Docs/COMPLIANCE/lawful-basis-register.json'],
    },
    {
      id: 'S18.Notification',
      name: 'Section 18 — Notification to data subject',
      description:
        'Responsible party must take reasonably practicable steps to ' +
        'ensure data subject is aware of identity, purpose, voluntary/' +
        'mandatory nature, recipients, source, and cross-border transfer.',
      jurisdiction: 'ZA',
      satisfiedBy: ['apps/portal/src/privacy-notice', 'packages/compliance-plugins'],
    },
    {
      id: 'S19.SecuritySafeguards',
      name: 'Section 19 — Security safeguards on integrity and confidentiality',
      description:
        'Responsible party must secure integrity and confidentiality of ' +
        'personal information through appropriate, reasonable technical ' +
        'and organisational measures.',
      jurisdiction: 'ZA',
      satisfiedBy: [
        'packages/compliance-pack/src/encryption',
        'packages/authz-policy',
      ],
    },
    {
      id: 'S20.OperatorProcessing',
      name: 'Section 20 — Information processed by operator',
      description:
        'Personal information processed by an operator must be done with ' +
        "the knowledge or authorisation of the responsible party and " +
        'subject to a written contract.',
      jurisdiction: 'ZA',
      satisfiedBy: ['Docs/COMPLIANCE/DPA_TEMPLATE.md'],
    },
    {
      id: 'S21.OperatorSafeguards',
      name: 'Section 21 — Security measures regarding information processed by operator',
      description:
        'Operator must establish and maintain security measures equivalent ' +
        'to those required of the responsible party.',
      jurisdiction: 'ZA',
      satisfiedBy: [
        'packages/compliance-pack/src/encryption',
        'packages/observability/src/logger.ts',
      ],
    },
    {
      id: 'S22.BreachNotification',
      name: 'Section 22 — Notification of security compromises',
      description:
        'Responsible party must notify the Information Regulator and the ' +
        'data subject as soon as reasonably possible after discovery of a ' +
        'security compromise.',
      jurisdiction: 'ZA',
      satisfiedBy: ['packages/compliance-pack/src/breach'],
    },
    {
      id: 'S23.AccessRequest',
      name: 'Section 23 — Access to personal information',
      description:
        'Data subject is entitled to request whether responsible party ' +
        'holds personal information about them and a description of it.',
      jurisdiction: 'ZA',
      satisfiedBy: ['packages/compliance-pack/src/dsar'],
    },
    {
      id: 'S24.CorrectionRequest',
      name: 'Section 24 — Correction of personal information',
      description:
        'Data subject may request correction or deletion of personal ' +
        'information that is inaccurate, irrelevant, excessive, ' +
        'out-of-date, incomplete, misleading, or obtained unlawfully.',
      jurisdiction: 'ZA',
      satisfiedBy: ['packages/compliance-pack/src/dsar'],
    },
    {
      id: 'S72.CrossBorder',
      name: 'Section 72 — Transfers of personal information outside RSA',
      description:
        'Responsible party may not transfer personal information about a ' +
        'data subject to a third party in a foreign country unless one of ' +
        'the listed safeguards is in place.',
      jurisdiction: 'ZA',
      satisfiedBy: [
        'packages/compliance-pack/src/residency',
        'Docs/COMPLIANCE/cross-border-transfer-policy.md',
      ],
    },
  ],
};
