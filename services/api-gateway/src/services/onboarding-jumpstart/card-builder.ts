/**
 * Day-1 jumpstart card builder — Wave COMPANY-BRAIN (Y-D).
 *
 * Pure function. Takes the inferrer's IngestIntent + a few stable
 * upload facts and renders the bilingual welcome card the cockpit
 * inlines in the chat panel.
 *
 * No I/O — testable in isolation. The persistence layer reads this
 * card back via the JumpstartResult so the cockpit can re-render the
 * welcome block without re-running the LLM.
 */

import type { IngestIntent } from '../ingestion-intent-inferrer/types.js';
import type { JumpstartCard } from './types.js';

export interface CardInput {
  readonly filename: string;
  readonly summaryEn: string | null;
  readonly summarySw: string | null;
  readonly intent: IngestIntent;
}

export function buildJumpstartCard(input: CardInput): JumpstartCard {
  const { intent, filename, summaryEn, summarySw } = input;
  const totalProposals =
    intent.proposedTabs.length +
    intent.proposedReminders.length +
    intent.proposedOpportunities.length +
    intent.proposedRisks.length;

  const headerEn = `Karibu! Borjie now knows your business.`;
  const headerSw = `Karibu! Borjie sasa anajua biashara yako.`;

  const subheaderEn = totalProposals === 0
    ? `Your first upload (${filename}) is indexed and recallable.`
    : `Your first upload (${filename}) is indexed, recallable, and Borjie surfaced ${totalProposals} insight${totalProposals === 1 ? '' : 's'} below — tap any to act on it.`;
  const subheaderSw = totalProposals === 0
    ? `Hati yako ya kwanza (${filename}) imehifadhiwa na inapatikana.`
    : `Hati yako ya kwanza (${filename}) imehifadhiwa na inapatikana — Borjie amependekeza mambo ${totalProposals} hapa chini, bofya yoyote ili kuyatekeleza.`;

  const metrics: Array<{ labelEn: string; labelSw: string; value: string }> = [
    {
      labelEn: 'Proposed tabs',
      labelSw: 'Vichupo vilivyopendekezwa',
      value: String(intent.proposedTabs.length),
    },
    {
      labelEn: 'Reminders',
      labelSw: 'Kumbusho',
      value: String(intent.proposedReminders.length),
    },
    {
      labelEn: 'Opportunities',
      labelSw: 'Fursa',
      value: String(intent.proposedOpportunities.length),
    },
    {
      labelEn: 'Risks',
      labelSw: 'Hatari',
      value: String(intent.proposedRisks.length),
    },
  ];

  if (summaryEn && summaryEn.length > 0) {
    metrics.push({
      labelEn: 'Summary',
      labelSw: 'Muhtasari',
      value: summaryEn.slice(0, 140),
    });
  }
  if (summarySw && summarySw.length > 0 && summarySw !== summaryEn) {
    metrics.push({
      labelEn: 'Muhtasari (sw)',
      labelSw: 'Muhtasari (sw)',
      value: summarySw.slice(0, 140),
    });
  }

  return Object.freeze({
    headerEn,
    headerSw,
    subheaderEn,
    subheaderSw,
    metrics: Object.freeze(metrics),
    intent,
  });
}
