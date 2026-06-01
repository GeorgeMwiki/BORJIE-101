/**
 * `after_hours.schedule_inspection_draft` — DRAFT-only.
 *
 * Proposes up to 3 site-inspection slots from the owner's calendar.
 * The owner approves one (or rejects all) before the buyer is told.
 * Never books a slot directly.
 */

export interface OwnerCalendarSlot {
  readonly startMs: number;
  readonly endMs: number;
  readonly free: boolean;
}

export interface ScheduleInspectionDraftArgs {
  readonly slots: ReadonlyArray<OwnerCalendarSlot>;
  readonly nowMs: number;
  readonly lotId: string;
  readonly buyerName: string;
  readonly language: 'en' | 'sw' | 'mixed';
  /** Earliest slot we accept (e.g. 24h notice). Defaults to 24h. */
  readonly minLeadMs?: number;
  /** How far out to look. Defaults to 7 days. */
  readonly windowMs?: number;
}

export interface ProposedSlot {
  readonly startMs: number;
  readonly endMs: number;
  readonly humanLabel: string;
}

export interface ScheduleInspectionDraftResult {
  readonly proposals: ReadonlyArray<ProposedSlot>;
  readonly draftStatus: 'queued-for-owner-review';
  readonly buyerMessage: string;
}

const DEFAULT_MIN_LEAD_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PROPOSALS = 3;

export function scheduleInspectionDraft(args: ScheduleInspectionDraftArgs): ScheduleInspectionDraftResult {
  const minLead = args.minLeadMs ?? DEFAULT_MIN_LEAD_MS;
  const window = args.windowMs ?? DEFAULT_WINDOW_MS;
  const earliest = args.nowMs + minLead;
  const latest = args.nowMs + window;

  const candidates = args.slots
    .filter(s => s.free && s.startMs >= earliest && s.startMs <= latest)
    .slice()
    .sort((a, b) => a.startMs - b.startMs);

  const proposals: ProposedSlot[] = candidates.slice(0, MAX_PROPOSALS).map(s => ({
    startMs: s.startMs,
    endMs: s.endMs,
    humanLabel: formatSlot(s.startMs, args.language),
  }));

  const buyerMessage = renderMessage({
    proposals,
    buyerName: args.buyerName,
    lotId: args.lotId,
    lang: args.language,
  });

  return Object.freeze({
    proposals: Object.freeze(proposals),
    draftStatus: 'queued-for-owner-review',
    buyerMessage,
  });
}

function formatSlot(startMs: number, lang: 'en' | 'sw' | 'mixed'): string {
  const d = new Date(startMs);
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const day = d.getUTCDate();
  const hour = d.getUTCHours();
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const hr = hour < 12 ? `${hour}:${mm} AM` : hour === 12 ? `12:${mm} PM` : `${hour - 12}:${mm} PM`;
  if (lang === 'sw') return `${day} ${month}, saa ${hr}`;
  return `${month} ${day}, ${hr}`;
}

function renderMessage(args: {
  readonly proposals: ReadonlyArray<ProposedSlot>;
  readonly buyerName: string;
  readonly lotId: string;
  readonly lang: 'en' | 'sw' | 'mixed';
}): string {
  if (args.proposals.length === 0) {
    return args.lang === 'sw'
      ? `Habari ${args.buyerName}, kwa sasa hatuna nafasi za ukaguzi kwa wiki hii. Tutakujulisha tukipata.`
      : `Hello ${args.buyerName}, we do not have free inspection windows this week. We will let you know when one opens up.`;
  }
  const labels = args.proposals.map((p, i) => `${i + 1}. ${p.humanLabel}`).join('\n');
  if (args.lang === 'sw') {
    return `Habari ${args.buyerName}, kwa lot ${args.lotId}, tunapendekeza nyakati hizi za ukaguzi:\n${labels}\nTafadhali chagua moja inayokufaa.`;
  }
  return `Hello ${args.buyerName}, for lot ${args.lotId} we propose the following inspection slots:\n${labels}\nReply with the option that works for you.`;
}
