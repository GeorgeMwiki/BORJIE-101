import { describe, expect, it } from 'vitest';
import {
  classifyComplaint,
  type ComplaintCategory,
  type ComplaintSeverity,
} from '../tools/classify-complaint.js';

interface Case {
  readonly text: string;
  readonly expectedCategory: ComplaintCategory;
  readonly expectedSeverityAtLeast?: ComplaintSeverity;
  readonly expectedSeverityAtMost?: ComplaintSeverity;
}

const RANK: Record<ComplaintSeverity, number> = {
  chatter: 0,
  standard: 1,
  urgent: 2,
  critical: 3,
};

const CASES: ReadonlyArray<Case> = [
  // SAFETY (critical) — 5
  { text: 'I feel unsafe in this building, broken stairs and smoke alarm dead', expectedCategory: 'safety', expectedSeverityAtLeast: 'critical' },
  { text: 'There is a gas leak in the kitchen, please help urgently', expectedCategory: 'safety', expectedSeverityAtLeast: 'critical' },
  { text: 'A wall is about to collapse, structural collapse imminent', expectedCategory: 'safety', expectedSeverityAtLeast: 'critical' },
  { text: 'Electric shock from the bathroom switch, very dangerous', expectedCategory: 'safety', expectedSeverityAtLeast: 'critical' },
  { text: 'I was just attacked at the gate by someone, I feel unsafe', expectedCategory: 'safety', expectedSeverityAtLeast: 'critical' },

  // FAIR-TREATMENT — 5
  { text: 'The estate manager is harassing me about my late rent', expectedCategory: 'fair-treatment', expectedSeverityAtLeast: 'urgent' },
  { text: 'I am being threatened with eviction unfairly', expectedCategory: 'fair-treatment', expectedSeverityAtLeast: 'urgent' },
  { text: 'I am being treated unfairly because of my ethnicity, discrimination', expectedCategory: 'fair-treatment', expectedSeverityAtLeast: 'urgent' },
  { text: 'Retaliation for complaining about the lift, this is unfair', expectedCategory: 'fair-treatment', expectedSeverityAtLeast: 'urgent' },
  { text: 'Eviction threat issued today because I asked for repair', expectedCategory: 'fair-treatment', expectedSeverityAtLeast: 'urgent' },

  // PRIVACY — 4
  { text: 'The caretaker entered without notice while I was sleeping', expectedCategory: 'privacy', expectedSeverityAtLeast: 'urgent' },
  { text: 'There is a CCTV camera pointed into my bedroom window', expectedCategory: 'privacy', expectedSeverityAtLeast: 'urgent' },
  { text: 'My personal data was shared with another tenant, privacy breach', expectedCategory: 'privacy', expectedSeverityAtLeast: 'urgent' },
  { text: 'Privacy violation — someone recorded me on cctv inside the lift', expectedCategory: 'privacy', expectedSeverityAtLeast: 'urgent' },

  // BILLING — 6
  { text: 'I was overcharged on my invoice this month by 50,000 TZS', expectedCategory: 'billing' },
  { text: 'The deposit refund is wrong, missing 100,000 TZS', expectedCategory: 'billing' },
  { text: 'Late fee charged but I paid on time, billing error', expectedCategory: 'billing' },
  { text: 'The rent calculation looks wrong on the latest invoice', expectedCategory: 'billing' },
  { text: 'Wrong invoice — billed twice for the same month', expectedCategory: 'billing' },
  { text: 'Refund of deposit pending for 3 months now, please act today', expectedCategory: 'billing', expectedSeverityAtLeast: 'urgent' },

  // NEIGHBOR NOISE — 4
  { text: 'My noisy neighbour plays loud music until 3 am every night', expectedCategory: 'neighbor-noise' },
  { text: 'There is a party next door every weekend, very loud music', expectedCategory: 'neighbor-noise' },
  { text: 'Constant shouting from the unit above, cannot sleep', expectedCategory: 'neighbor-noise' },
  { text: 'Noise from upstairs neighbour late at night', expectedCategory: 'neighbor-noise' },

  // LEASE-QUESTION — 4
  { text: 'Question about the termination clause in my lease', expectedCategory: 'lease-question' },
  { text: 'Can I renew my lease for another year, and what is the notice period?', expectedCategory: 'lease-question' },
  { text: 'The lease says one thing, the contract says another, please clarify', expectedCategory: 'lease-question' },
  { text: 'I need to know the notice period before I move out', expectedCategory: 'lease-question' },

  // MAINTENANCE — 6
  { text: 'The kitchen tap is leaking and needs a plumber', expectedCategory: 'maintenance' },
  { text: 'AC not cooling, very hot inside', expectedCategory: 'maintenance' },
  { text: 'Cockroach problem in the kitchen, pest control needed', expectedCategory: 'maintenance' },
  { text: 'Electric socket loose in the living room, not working', expectedCategory: 'maintenance' },
  { text: 'Broken handle on the bathroom door, needs repair', expectedCategory: 'maintenance' },
  { text: 'Lights not working in the corridor, needs an electrician', expectedCategory: 'maintenance' },

  // SWAHILI cases — 16 (>15 required)
  { text: 'Nimekasirika sana, hesabu ya kodi yangu sio sahihi', expectedCategory: 'billing' },
  { text: 'Tafadhali, ankara batili ya mwezi huu', expectedCategory: 'billing' },
  { text: 'Nina swali kuhusu mkataba wangu, kifungu cha kuvunja mkataba', expectedCategory: 'lease-question' },
  { text: 'Kifungu cha mkataba sicho wazi, naomba ufafanuzi', expectedCategory: 'lease-question' },
  { text: 'Jirani mwenye kelele kila usiku, muziki mkubwa', expectedCategory: 'neighbor-noise' },
  { text: 'Wanapiga kelele usiku wote, sijali kulala', expectedCategory: 'neighbor-noise' },
  { text: 'Caretaker aliingia nyumbani kwangu bila taarifa', expectedCategory: 'privacy', expectedSeverityAtLeast: 'urgent' },
  { text: 'Nasikia kuna ubaguzi kutoka kwa msimamizi, sina haki', expectedCategory: 'fair-treatment', expectedSeverityAtLeast: 'urgent' },
  { text: 'Gesi inavuja jikoni, hatari ya maisha, haraka', expectedCategory: 'safety', expectedSeverityAtLeast: 'critical' },
  { text: 'Sijihisi salama hapa, tishio kutoka kwa mwenye jirani', expectedCategory: 'safety', expectedSeverityAtLeast: 'critical' },
  { text: 'Bomba la maji inavuja jikoni, tafadhali msaada', expectedCategory: 'maintenance' },
  { text: 'Mende wengi sana jikoni, wadudu wamejaa', expectedCategory: 'maintenance' },
  { text: 'Umeme umekatika tena, haifanyi kazi tangu jana', expectedCategory: 'maintenance' },
  { text: 'Friji haifanyi kazi vizuri, chakula kinaharibika', expectedCategory: 'maintenance' },
  { text: 'Asante kwa huduma nzuri, nashukuru sana', expectedCategory: 'other', expectedSeverityAtMost: 'chatter' },
  { text: 'Tafadhali nisaidie haraka, ankara sio sahihi tena', expectedCategory: 'billing' },

  // Chatter / other — 3
  { text: 'FYI — just letting you know the lobby door squeaks a bit', expectedCategory: 'other', expectedSeverityAtMost: 'chatter' },
  { text: 'No big deal, but the mailbox is a little loose', expectedCategory: 'other', expectedSeverityAtMost: 'chatter' },
  { text: 'Thank you for the quick response, appreciate it', expectedCategory: 'other', expectedSeverityAtMost: 'chatter' },
];

describe('classifyComplaint — accuracy harness', () => {
  it('has at least 50 labelled cases', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(50);
  });

  it('classifies at least 85% of the holdout correctly', () => {
    let hits = 0;
    const misses: Array<{ text: string; expected: ComplaintCategory; got: ComplaintCategory; gotSev: ComplaintSeverity }> = [];
    for (const c of CASES) {
      const r = classifyComplaint(c.text);
      let ok = r.category === c.expectedCategory;
      if (ok && c.expectedSeverityAtLeast) {
        ok = RANK[r.severity] >= RANK[c.expectedSeverityAtLeast];
      }
      if (ok && c.expectedSeverityAtMost) {
        ok = RANK[r.severity] <= RANK[c.expectedSeverityAtMost];
      }
      if (ok) {
        hits += 1;
      } else {
        misses.push({ text: c.text, expected: c.expectedCategory, got: r.category, gotSev: r.severity });
      }
    }
    const accuracy = hits / CASES.length;
    if (accuracy < 0.85) console.error('Holdout misses:', misses);
    expect(accuracy).toBeGreaterThanOrEqual(0.85);
  });

  it('detects Swahili language on heavy-Swahili inputs', () => {
    const r = classifyComplaint('Tafadhali nisaidie, ankara sio sahihi, nimekasirika sana');
    expect(r.detectedLanguage === 'sw' || r.detectedLanguage === 'mixed').toBe(true);
  });

  it('detects anger sentiment', () => {
    const r = classifyComplaint('I am furious about this unacceptable service, will sue');
    expect(r.sentiment).toBe('angry');
  });

  it('detects appreciative sentiment', () => {
    const r = classifyComplaint('Thank you for the quick response, I appreciate it');
    expect(r.sentiment).toBe('appreciative');
  });
});
