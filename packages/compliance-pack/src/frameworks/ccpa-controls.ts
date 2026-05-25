/**
 * CCPA + CPRA — California Consumer Privacy Act (Civil Code §1798.100
 * et seq.) as amended by the California Privacy Rights Act of 2020.
 *
 * Six core consumer rights modelled as control entries; enforcement
 * by the California Privacy Protection Agency (CPPA) since 2023.
 *
 * Reference: https://en.wikipedia.org/wiki/California_Consumer_Privacy_Act +
 * https://oag.ca.gov/privacy/ccpa/regs.
 */

import type { ControlCatalog } from '../types.js';

export const ccpaCatalog: ControlCatalog = {
  frameworkId: 'ccpa',
  displayName: 'CCPA + CPRA (California Civil Code §1798.100 et seq.)',
  version: '2020-CPRA',
  jurisdiction: 'US-CA',
  controls: [
    {
      id: '1798.100',
      name: 'Right to know (general)',
      description:
        'Consumers have the right to request that a business disclose ' +
        'categories and specific pieces of personal information collected.',
      jurisdiction: 'US-CA',
      satisfiedBy: ['packages/compliance-pack/src/dsar'],
    },
    {
      id: '1798.105',
      name: 'Right to delete',
      description:
        'Consumers have the right to request that a business delete any ' +
        'personal information about them. Response: 45 days (extensible).',
      jurisdiction: 'US-CA',
      satisfiedBy: [
        'packages/compliance-pack/src/dsar',
        'packages/compliance-pack/src/erasure-cascade',
      ],
    },
    {
      id: '1798.106',
      name: 'Right to correct inaccurate information',
      description:
        'Consumers have the right to request that a business correct ' +
        'inaccurate personal information.',
      jurisdiction: 'US-CA',
      satisfiedBy: ['packages/compliance-pack/src/dsar'],
    },
    {
      id: '1798.110',
      name: 'Right to know — specific pieces collected',
      description:
        'On verifiable request, business shall disclose the specific ' +
        'pieces of personal information collected, categories of sources, ' +
        'and purposes for collection.',
      jurisdiction: 'US-CA',
      satisfiedBy: ['packages/compliance-pack/src/dsar'],
    },
    {
      id: '1798.115',
      name: 'Right to know — sold or disclosed for a business purpose',
      description:
        'Consumers have the right to know what categories of personal ' +
        'information were sold or disclosed for a business purpose and ' +
        'to whom.',
      jurisdiction: 'US-CA',
      satisfiedBy: ['Docs/COMPLIANCE/lawful-basis-register.json'],
    },
    {
      id: '1798.120',
      name: 'Right to opt-out of sale or sharing',
      description:
        'Consumers have the right, at any time, to direct a business that ' +
        'sells or shares personal information to stop. Global Privacy ' +
        'Control (GPC) signal must be honoured.',
      jurisdiction: 'US-CA',
      satisfiedBy: ['apps/portal/src/privacy-controls', 'packages/compliance-plugins'],
    },
    {
      id: '1798.121',
      name: 'Right to limit use of sensitive personal information',
      description:
        'Consumers have the right to limit the use and disclosure of ' +
        'sensitive personal information (CPRA-added).',
      jurisdiction: 'US-CA',
      satisfiedBy: ['packages/compliance-plugins'],
    },
    {
      id: '1798.125',
      name: 'Right to non-discrimination',
      description:
        'A business shall not discriminate against a consumer for ' +
        'exercising any of the rights under this title.',
      jurisdiction: 'US-CA',
      satisfiedBy: ['Docs/LEGAL.md'],
    },
    {
      id: '1798.130',
      name: 'Verifiable consumer request — disclosure SLA',
      description:
        'Business shall respond to a verifiable consumer request within ' +
        '45 days. May be extended once by an additional 45 days when ' +
        'reasonably necessary, with notice.',
      jurisdiction: 'US-CA',
      satisfiedBy: ['packages/compliance-pack/src/dsar'],
    },
    {
      id: '1798.140',
      name: 'Definition of sensitive personal information',
      description:
        'CPRA-added category: SSN, driver license, financial account ' +
        'login, precise geolocation, race, religion, health, biometric, ' +
        'genetic, sexual orientation, contents of messages.',
      jurisdiction: 'US-CA',
      satisfiedBy: ['packages/compliance-pack/src/types.ts'],
    },
    {
      id: '1798.150',
      name: 'Private right of action for data breach',
      description:
        'Consumer may bring a civil action where personal information is ' +
        'subject to unauthorised access due to failure to implement and ' +
        'maintain reasonable security procedures. $100-$750 per consumer ' +
        'per incident or actual damages.',
      jurisdiction: 'US-CA',
      satisfiedBy: [
        'packages/compliance-pack/src/encryption',
        'packages/compliance-pack/src/breach',
      ],
    },
  ],
};
