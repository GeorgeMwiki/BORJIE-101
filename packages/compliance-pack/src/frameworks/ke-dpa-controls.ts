/**
 * Kenya Data Protection Act, 2019 (Act No. 24 of 2019).
 *
 * Regulator: Office of the Data Protection Commissioner (ODPC).
 *
 * Reference: https://www.dataprotection.go.ke/ +
 * Docs/COMPLIANCE/DPA-ke-runbook.md.
 */

import type { ControlCatalog } from '../types.js';

export const keDpaCatalog: ControlCatalog = {
  frameworkId: 'ke-dpa',
  displayName: 'Kenya Data Protection Act, 2019 (Act 24 of 2019)',
  version: '2019',
  jurisdiction: 'KE',
  controls: [
    {
      id: 'KE.S25.Principles',
      name: 'Section 25 — Principles of data protection',
      description:
        'Lawfulness, fairness, transparency, purpose limitation, data ' +
        'minimisation, accuracy, storage limitation, integrity, and ' +
        'confidentiality.',
      jurisdiction: 'KE',
      satisfiedBy: ['Docs/COMPLIANCE/lawful-basis-register.json'],
    },
    {
      id: 'KE.S26.Rights',
      name: 'Section 26 — Rights of a data subject',
      description:
        'Right to be informed, access, object, correction/deletion, and ' +
        'data portability.',
      jurisdiction: 'KE',
      satisfiedBy: [
        'packages/compliance-pack/src/dsar',
        'packages/compliance-pack/src/erasure-cascade',
      ],
    },
    {
      id: 'KE.S30.Consent',
      name: 'Section 30 — Conditions for processing — consent',
      description:
        'Consent must be express, recorded, freely given, specific, ' +
        'informed, and unambiguous. May be withdrawn at any time.',
      jurisdiction: 'KE',
      satisfiedBy: ['Docs/COMPLIANCE/consent-revocation-runbook.md'],
    },
    {
      id: 'KE.S37.Notification',
      name: 'Section 37 — Notification at collection',
      description:
        'Data controller must inform subject of identity, purpose, ' +
        'recipients, retention, rights, and source of data.',
      jurisdiction: 'KE',
      satisfiedBy: ['apps/portal/src/privacy-notice'],
    },
    {
      id: 'KE.S40.SecurityMeasures',
      name: 'Section 40 — Security of personal data',
      description:
        'Data controller and processor must implement appropriate ' +
        'technical and organisational measures.',
      jurisdiction: 'KE',
      satisfiedBy: ['packages/compliance-pack/src/encryption', 'packages/authz-policy'],
    },
    {
      id: 'KE.S43.BreachNotification',
      name: 'Section 43 — Notification of personal data breach (72 hours)',
      description:
        'Data controller must notify the ODPC within 72 hours of becoming ' +
        'aware. Data subject notification required where breach is likely ' +
        'to result in real risk.',
      jurisdiction: 'KE',
      satisfiedBy: ['packages/compliance-pack/src/breach'],
    },
    {
      id: 'KE.S48.CrossBorder',
      name: 'Section 48 — Conditions for transfer outside Kenya',
      description:
        'Transfer outside Kenya permitted only with appropriate ' +
        'safeguards: ODPC adequacy decision, BCRs, SCCs, or subject ' +
        'explicit consent.',
      jurisdiction: 'KE',
      satisfiedBy: ['packages/compliance-pack/src/residency'],
    },
    {
      id: 'KE.S50.DPIA',
      name: 'Section 50 — Data protection impact assessment',
      description:
        'Where processing is likely to result in high risk to subject ' +
        'rights, controller must conduct a DPIA prior to processing.',
      jurisdiction: 'KE',
      satisfiedBy: ['Docs/COMPLIANCE/dpia-template.md'],
    },
    {
      id: 'KE.S18.Registration',
      name: 'Section 18 — Registration with the ODPC',
      description:
        'Data controllers and processors above prescribed thresholds must ' +
        'register with the ODPC. Operating without registration is an ' +
        'offence.',
      jurisdiction: 'KE',
      satisfiedBy: ['Docs/COMPLIANCE/DPA-ke-runbook.md'],
    },
    {
      id: 'KE.DSARSLATime',
      name: 'DSAR response — 30 days statutory window',
      description:
        'Data controller must respond to a subject request within 30 ' +
        'days of receipt. Extensible by 60 days where complex.',
      jurisdiction: 'KE',
      satisfiedBy: ['packages/compliance-pack/src/dsar'],
    },
  ],
};
