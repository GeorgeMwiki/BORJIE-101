/**
 * Built-in tab descriptors — Chat / Docs / Drafts / Reminders / Insights /
 * Doc-context. These have always existed in the OwnerOSShell but lived
 * as a hardcoded union; here we expose them through the same descriptor
 * contract so the spawn menu, intent matcher and brain payload can
 * reason about them uniformly with the spawnable domains.
 *
 * The renderer is wired by the shell directly (see OwnerOSShell.tsx)
 * because chat / docs / drafts / reminders / insights have unique
 * prop shapes (salutation, onSpawnDocTab, etc.) that don't fit the
 * generic OwnerOSPanelProps shape.
 */

import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';

const BUILTINS: ReadonlyArray<OwnerOSTabDescriptor> = [
  {
    type: 'chat',
    labelEn: 'Chat',
    labelSw: 'Mazungumzo',
    descriptionEn: 'Talk to Mr. Mwikila — your AI mining COO.',
    descriptionSw: 'Ongea na Bw. Mwikila — COO wako wa AI wa madini.',
    iconName: 'MessageSquare',
    color: 'gold',
    contextSchema: ownerOsTabContextSchema,
    intentMatchers: { keywords: [] },
    suggestedTools: [],
    briefSlices: [],
    rendererId: 'builtin:chat',
    pinnedByDefault: true,
    hiddenFromSpawnMenu: true,
  },
  {
    type: 'docs',
    labelEn: 'Docs',
    labelSw: 'Hati',
    descriptionEn: 'Owner document inbox + filed library.',
    descriptionSw: 'Sanduku la hati za mmiliki na maktaba.',
    iconName: 'FolderOpen',
    color: 'navy',
    contextSchema: ownerOsTabContextSchema,
    intentMatchers: {
      keywords: ['document', 'upload', 'file', 'attach', 'hati'],
    },
    suggestedTools: [],
    briefSlices: [],
    rendererId: 'builtin:docs',
    pinnedByDefault: true,
    hiddenFromSpawnMenu: true,
  },
  {
    type: 'drafts',
    labelEn: 'Drafts',
    labelSw: 'Rasimu',
    descriptionEn: 'Draft messages, letters and royalty cards waiting for sign-off.',
    descriptionSw: 'Rasimu za barua na kadi za mrabaha zinazosubiri saini.',
    iconName: 'Edit3',
    color: 'cream',
    contextSchema: ownerOsTabContextSchema,
    intentMatchers: {
      keywords: ['draft', 'letter', 'sign', 'rasimu'],
    },
    suggestedTools: [],
    briefSlices: [],
    rendererId: 'builtin:drafts',
    pinnedByDefault: true,
    hiddenFromSpawnMenu: true,
  },
  {
    type: 'reminders',
    labelEn: 'Reminders',
    labelSw: 'Vikumbusho',
    descriptionEn: 'Time-anchored reminders + nudges.',
    descriptionSw: 'Vikumbusho vyenye muda.',
    iconName: 'BellRing',
    color: 'warning',
    contextSchema: ownerOsTabContextSchema,
    intentMatchers: {
      keywords: ['remind', 'reminder', 'tomorrow', 'kumbusho'],
    },
    suggestedTools: [],
    briefSlices: [],
    rendererId: 'builtin:reminders',
    pinnedByDefault: true,
    hiddenFromSpawnMenu: true,
  },
  {
    type: 'insights',
    labelEn: 'Insights',
    labelSw: 'Maarifa',
    descriptionEn: 'Cross-domain insights surfaced by the brain.',
    descriptionSw: 'Maarifa ya wilaya mtambuka kutoka brain.',
    iconName: 'Sparkles',
    color: 'info',
    contextSchema: ownerOsTabContextSchema,
    intentMatchers: {
      keywords: ['insight', 'pattern', 'trend', 'maarifa', 'mwelekeo'],
    },
    suggestedTools: [],
    briefSlices: [],
    rendererId: 'builtin:insights',
    pinnedByDefault: true,
    hiddenFromSpawnMenu: true,
  },
  {
    type: 'doc-context',
    labelEn: 'Document',
    labelSw: 'Hati',
    descriptionEn: 'Conversation scoped to a single document.',
    descriptionSw: 'Mazungumzo yaliyopangwa kwa hati moja.',
    iconName: 'FileText',
    color: 'navy',
    contextSchema: ownerOsTabContextSchema,
    intentMatchers: { keywords: [] },
    suggestedTools: [],
    briefSlices: [],
    rendererId: 'builtin:doc-context',
    hiddenFromSpawnMenu: true,
  },
];

/** Side-effect: register all built-ins on import. */
for (const d of BUILTINS) registerTab(d);

export const BUILTIN_DESCRIPTORS = BUILTINS;
