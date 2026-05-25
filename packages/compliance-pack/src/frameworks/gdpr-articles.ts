/**
 * GDPR — EU Regulation 2016/679.
 *
 * Modelled at the article level. Articles 13/14/15/17/20/25/30/32/33/35
 * are the operational backbone the platform implements; we list those
 * plus a handful of supporting articles auditors commonly trace.
 *
 * Reference: https://gdpr-info.eu (article text) +
 * Docs/COMPLIANCE/GDPR-eu-runbook.md (operator runbook).
 */

import type { ControlCatalog } from '../types.js';

export const gdprCatalog: ControlCatalog = {
  frameworkId: 'gdpr',
  displayName: 'GDPR (EU Regulation 2016/679)',
  version: '2016/679',
  jurisdiction: 'EU',
  controls: [
    {
      id: 'Art.6',
      name: 'Lawfulness of processing',
      description:
        'Processing shall be lawful only if and to the extent that at ' +
        'least one of the listed legal bases applies (consent, contract, ' +
        'legal obligation, vital interest, public task, legitimate interest).',
      jurisdiction: 'EU',
      satisfiedBy: ['Docs/COMPLIANCE/lawful-basis-register.json'],
    },
    {
      id: 'Art.13',
      name: 'Information to be provided where personal data are collected from the data subject',
      description:
        'Controllers must provide identity, purposes, legal basis, ' +
        'recipients, retention period, and rights at the time data is ' +
        'collected directly from the subject.',
      jurisdiction: 'EU',
      satisfiedBy: ['packages/compliance-plugins', 'apps/portal/src/privacy-notice'],
    },
    {
      id: 'Art.14',
      name: 'Information to be provided where personal data have not been obtained from the data subject',
      description:
        'Where data is collected indirectly, controllers must provide the ' +
        'same notice within a reasonable period (max 1 month).',
      jurisdiction: 'EU',
      satisfiedBy: ['packages/compliance-plugins', 'Docs/COMPLIANCE/DPA_TEMPLATE.md'],
    },
    {
      id: 'Art.15',
      name: 'Right of access by the data subject',
      description:
        'Data subjects have the right to obtain confirmation of ' +
        'processing and a copy of their personal data, free of charge for ' +
        'the first copy. Response SLA: 1 month (extensible by 2 more).',
      jurisdiction: 'EU',
      satisfiedBy: ['packages/compliance-pack/src/dsar'],
    },
    {
      id: 'Art.17',
      name: 'Right to erasure ("right to be forgotten")',
      description:
        'Data subjects have the right to obtain erasure of their personal ' +
        'data without undue delay where one of the listed grounds applies. ' +
        'Controllers must take reasonable steps to inform other controllers.',
      jurisdiction: 'EU',
      satisfiedBy: ['packages/compliance-pack/src/erasure-cascade'],
    },
    {
      id: 'Art.20',
      name: 'Right to data portability',
      description:
        'Data subjects have the right to receive their personal data in ' +
        'a structured, commonly used, machine-readable format and ' +
        'transmit it to another controller.',
      jurisdiction: 'EU',
      satisfiedBy: ['packages/compliance-pack/src/dsar'],
    },
    {
      id: 'Art.25',
      name: 'Data protection by design and by default',
      description:
        'Controllers shall implement appropriate technical and ' +
        'organisational measures designed to implement data-protection ' +
        'principles in an effective manner.',
      jurisdiction: 'EU',
      satisfiedBy: [
        'packages/compliance-pack/src/encryption',
        'packages/graph-privacy',
        'packages/authz-policy',
      ],
    },
    {
      id: 'Art.30',
      name: 'Records of processing activities',
      description:
        'Each controller shall maintain a record of processing activities ' +
        'including categories of data, purposes, recipients, retention, ' +
        'and security measures.',
      jurisdiction: 'EU',
      satisfiedBy: ['Docs/COMPLIANCE/GDPR_ARTICLE_30.md'],
    },
    {
      id: 'Art.32',
      name: 'Security of processing',
      description:
        'Controller and processor shall implement appropriate technical ' +
        'and organisational measures to ensure a level of security ' +
        'appropriate to the risk, including pseudonymisation and encryption.',
      jurisdiction: 'EU',
      satisfiedBy: [
        'packages/compliance-pack/src/encryption',
        'packages/observability/src/logger.ts',
      ],
    },
    {
      id: 'Art.33',
      name: 'Notification of a personal data breach to the supervisory authority',
      description:
        'In the case of a personal data breach, the controller shall ' +
        'notify the supervisory authority without undue delay and, where ' +
        'feasible, not later than 72 hours after becoming aware.',
      jurisdiction: 'EU',
      satisfiedBy: ['packages/compliance-pack/src/breach'],
    },
    {
      id: 'Art.34',
      name: 'Communication of a personal data breach to the data subject',
      description:
        'When the breach is likely to result in a high risk to subjects, ' +
        'the controller shall communicate it to subjects without undue delay.',
      jurisdiction: 'EU',
      satisfiedBy: ['packages/compliance-pack/src/breach'],
    },
    {
      id: 'Art.35',
      name: 'Data protection impact assessment (DPIA)',
      description:
        'Where processing is likely to result in a high risk, the ' +
        'controller shall carry out a DPIA prior to processing.',
      jurisdiction: 'EU',
      satisfiedBy: ['Docs/COMPLIANCE/dpia-template.md'],
    },
    {
      id: 'Art.44',
      name: 'General principle for transfers (cross-border)',
      description:
        'Any transfer of personal data outside the EU/EEA shall take ' +
        'place only on the conditions laid down in Chapter V.',
      jurisdiction: 'EU',
      satisfiedBy: [
        'packages/compliance-pack/src/residency',
        'Docs/COMPLIANCE/cross-border-transfer-policy.md',
      ],
    },
  ],
};
