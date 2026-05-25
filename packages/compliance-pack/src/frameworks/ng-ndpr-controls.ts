/**
 * Nigeria NDPR (2019) + Nigeria Data Protection Act 2023.
 *
 * Regulator: Nigeria Data Protection Commission (NDPC), established
 * by the 2023 Act (replacing the earlier NITDA supervisory function).
 *
 * Reference: Docs/COMPLIANCE/NDPA-ng-runbook.md.
 */

import type { ControlCatalog } from '../types.js';

export const ngNdprCatalog: ControlCatalog = {
  frameworkId: 'ng-ndpr',
  displayName: 'Nigeria NDPR (2019) + Data Protection Act 2023',
  version: '2023',
  jurisdiction: 'NG',
  controls: [
    {
      id: 'NG.S24.Principles',
      name: 'Section 24 — Principles and lawful basis of processing',
      description:
        'Lawfulness, fairness, transparency, purpose limitation, ' +
        'minimisation, accuracy, storage limitation, integrity, ' +
        'confidentiality, accountability.',
      jurisdiction: 'NG',
      satisfiedBy: ['Docs/COMPLIANCE/lawful-basis-register.json'],
    },
    {
      id: 'NG.S26.Consent',
      name: 'Section 26 — Consent',
      description:
        'Consent must be specific, freely given, informed, unambiguous, ' +
        'and recorded. Withdrawal as easy as giving.',
      jurisdiction: 'NG',
      satisfiedBy: ['Docs/COMPLIANCE/consent-revocation-runbook.md'],
    },
    {
      id: 'NG.S27.NoticeToSubject',
      name: 'Section 27 — Information to data subject',
      description:
        'Data controller must inform subject of identity, purposes, ' +
        'legal basis, recipients, retention, rights, and cross-border ' +
        'transfers.',
      jurisdiction: 'NG',
      satisfiedBy: ['apps/portal/src/privacy-notice'],
    },
    {
      id: 'NG.S34.SubjectRights',
      name: 'Section 34 — Rights of data subjects',
      description:
        'Right of access, rectification, erasure, portability, objection, ' +
        'and not to be subject to automated decision-making.',
      jurisdiction: 'NG',
      satisfiedBy: [
        'packages/compliance-pack/src/dsar',
        'packages/compliance-pack/src/erasure-cascade',
      ],
    },
    {
      id: 'NG.S39.Security',
      name: 'Section 39 — Security of personal data',
      description:
        'Data controller and processor must implement appropriate ' +
        'technical and organisational measures.',
      jurisdiction: 'NG',
      satisfiedBy: ['packages/compliance-pack/src/encryption'],
    },
    {
      id: 'NG.S40.BreachNotification',
      name: 'Section 40 — Notification of breach (72 hours)',
      description:
        'Data controller must notify the NDPC within 72 hours of becoming ' +
        'aware of a personal data breach where likely to result in risk.',
      jurisdiction: 'NG',
      satisfiedBy: ['packages/compliance-pack/src/breach'],
    },
    {
      id: 'NG.S41.CrossBorder',
      name: 'Section 41 — Cross-border transfer of personal data',
      description:
        'Transfer outside Nigeria permitted only with adequacy decision, ' +
        'binding corporate rules, standard contractual clauses, or ' +
        'explicit consent.',
      jurisdiction: 'NG',
      satisfiedBy: ['packages/compliance-pack/src/residency'],
    },
    {
      id: 'NG.S44.DPO',
      name: 'Section 44 — Data Protection Officer (data controller of major importance)',
      description:
        'Data controllers of major importance (above prescribed threshold) ' +
        'must appoint a DPO.',
      jurisdiction: 'NG',
      satisfiedBy: ['hr/dpo-appointment-letter'],
    },
    {
      id: 'NG.S65.Penalties',
      name: 'Section 65 — Administrative penalties',
      description:
        'NDPC may impose remedial measures and administrative fines up ' +
        'to 2% of annual gross revenue or NGN 10 million, whichever is ' +
        'higher, for major data controllers.',
      jurisdiction: 'NG',
      satisfiedBy: ['Docs/COMPLIANCE/NDPA-ng-runbook.md'],
    },
  ],
};
