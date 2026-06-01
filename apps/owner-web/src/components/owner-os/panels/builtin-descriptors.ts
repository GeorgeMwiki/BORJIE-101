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

import { ownerOsBStrings as S } from '@/i18n/strings/owner-os-b';

const BUILTINS: ReadonlyArray<OwnerOSTabDescriptor> = [
  {
    type: 'chat',
    labelEn: S.builtins.chatLabel.en,
    labelSw: S.builtins.chatLabel.sw,
    descriptionEn: S.builtins.chatDescription.en,
    descriptionSw: S.builtins.chatDescription.sw,
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
    labelEn: S.builtins.docsLabel.en,
    labelSw: S.builtins.docsLabel.sw,
    descriptionEn: S.builtins.docsDescription.en,
    descriptionSw: S.builtins.docsDescription.sw,
    iconName: 'FolderOpen',
    color: 'navy',
    contextSchema: ownerOsTabContextSchema,
    intentMatchers: {
      keywords: ['document', 'upload', 'file', 'attach', ...S.builtins.docsSwKeywords],
    },
    suggestedTools: [],
    briefSlices: [],
    rendererId: 'builtin:docs',
    pinnedByDefault: true,
    hiddenFromSpawnMenu: true,
  },
  {
    type: 'drafts',
    labelEn: S.builtins.draftsLabel.en,
    labelSw: S.builtins.draftsLabel.sw,
    descriptionEn: S.builtins.draftsDescription.en,
    descriptionSw: S.builtins.draftsDescription.sw,
    iconName: 'Edit3',
    color: 'cream',
    contextSchema: ownerOsTabContextSchema,
    intentMatchers: {
      keywords: ['draft', 'letter', 'sign', ...S.builtins.draftsSwKeywords],
    },
    suggestedTools: [],
    briefSlices: [],
    rendererId: 'builtin:drafts',
    pinnedByDefault: true,
    hiddenFromSpawnMenu: true,
  },
  {
    type: 'reminders',
    labelEn: S.builtins.remindersLabel.en,
    labelSw: S.builtins.remindersLabel.sw,
    descriptionEn: S.builtins.remindersDescription.en,
    descriptionSw: S.builtins.remindersDescription.sw,
    iconName: 'BellRing',
    color: 'warning',
    contextSchema: ownerOsTabContextSchema,
    intentMatchers: {
      keywords: ['remind', 'reminder', 'tomorrow', ...S.builtins.remindersSwKeywords],
    },
    suggestedTools: [],
    briefSlices: [],
    rendererId: 'builtin:reminders',
    pinnedByDefault: true,
    hiddenFromSpawnMenu: true,
  },
  {
    type: 'insights',
    labelEn: S.builtins.insightsLabel.en,
    labelSw: S.builtins.insightsLabel.sw,
    descriptionEn: S.builtins.insightsDescription.en,
    descriptionSw: S.builtins.insightsDescription.sw,
    iconName: 'Sparkles',
    color: 'info',
    contextSchema: ownerOsTabContextSchema,
    intentMatchers: {
      keywords: ['insight', 'pattern', 'trend', ...S.builtins.insightsSwKeywords],
    },
    suggestedTools: [],
    briefSlices: [],
    rendererId: 'builtin:insights',
    pinnedByDefault: true,
    hiddenFromSpawnMenu: true,
  },
  {
    type: 'doc-context',
    labelEn: S.builtins.docContextLabel.en,
    labelSw: S.builtins.docContextLabel.sw,
    descriptionEn: S.builtins.docContextDescription.en,
    descriptionSw: S.builtins.docContextDescription.sw,
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
