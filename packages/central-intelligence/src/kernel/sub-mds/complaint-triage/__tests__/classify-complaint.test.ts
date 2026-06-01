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
  { text: 'I feel unsafe in this pit, rockfall and no shoring', expectedCategory: 'safety', expectedSeverityAtLeast: 'critical' },
  { text: 'There is a gas leak in the shaft, please help urgently', expectedCategory: 'safety', expectedSeverityAtLeast: 'critical' },
  { text: 'A tunnel collapse is imminent, ground is cracking', expectedCategory: 'safety', expectedSeverityAtLeast: 'critical' },
  { text: 'Electric shock from the pump panel, very dangerous', expectedCategory: 'safety', expectedSeverityAtLeast: 'critical' },
  { text: 'I was just attacked at the gate by someone, I feel unsafe', expectedCategory: 'safety', expectedSeverityAtLeast: 'critical' },

  // FAIR-TREATMENT — 5
  { text: 'The site manager is harassing me about my shift', expectedCategory: 'fair-treatment', expectedSeverityAtLeast: 'urgent' },
  { text: 'I am being threatened with a licence suspension threat unfairly', expectedCategory: 'fair-treatment', expectedSeverityAtLeast: 'urgent' },
  { text: 'I am being treated unfairly because of my ethnicity, discrimination', expectedCategory: 'fair-treatment', expectedSeverityAtLeast: 'urgent' },
  { text: 'Retaliation for raising a safety flag, this is unfair', expectedCategory: 'fair-treatment', expectedSeverityAtLeast: 'urgent' },
  { text: 'Harassment from the supervisor again, I have no recourse, unfair', expectedCategory: 'fair-treatment', expectedSeverityAtLeast: 'urgent' },

  // PRIVACY — 4
  { text: 'The guard entered without notice while I was resting', expectedCategory: 'privacy', expectedSeverityAtLeast: 'urgent' },
  { text: 'There is a CCTV camera pointed into the change room', expectedCategory: 'privacy', expectedSeverityAtLeast: 'urgent' },
  { text: 'My personal data was shared with another buyer, privacy breach', expectedCategory: 'privacy', expectedSeverityAtLeast: 'urgent' },
  { text: 'Privacy violation — someone recorded me on cctv at the gate', expectedCategory: 'privacy', expectedSeverityAtLeast: 'urgent' },

  // BILLING — 6
  { text: 'I was underpaid on my settlement this month by 50,000 TZS', expectedCategory: 'billing' },
  { text: 'The advance refund is wrong, missing 100,000 TZS', expectedCategory: 'billing' },
  { text: 'Short payment on the last delivery, payment error', expectedCategory: 'billing' },
  { text: 'The royalty deduction looks wrong on the latest settlement', expectedCategory: 'billing' },
  { text: 'Wrong settlement — paid twice deducted for the same lot', expectedCategory: 'billing' },
  { text: 'Refund of advance pending for 3 months now, please act today', expectedCategory: 'billing', expectedSeverityAtLeast: 'urgent' },

  // COMMUNITY — 4
  { text: 'Dust from the site is covering our village every day', expectedCategory: 'community' },
  { text: 'Blasting noise every afternoon, the whole village shakes, vibration', expectedCategory: 'community' },
  { text: 'Water contamination downstream from the wash plant', expectedCategory: 'community' },
  { text: 'Constant noise and dust from the site late at night', expectedCategory: 'community' },

  // CONTRACT-QUESTION — 4
  { text: 'Question about the termination clause in my offtake agreement', expectedCategory: 'contract-question' },
  { text: 'Can I renew my contract for another year, and what is the notice period?', expectedCategory: 'contract-question' },
  { text: 'The contract says one thing, the contract clause says another, please clarify', expectedCategory: 'contract-question' },
  { text: 'I need to know the notice period before termination', expectedCategory: 'contract-question' },

  // MAINTENANCE — 6
  { text: 'The dewatering pump is leaking and needs a fitter', expectedCategory: 'maintenance' },
  { text: 'Generator not working, no power at the plant', expectedCategory: 'maintenance' },
  { text: 'The crusher is broken, production is stopped', expectedCategory: 'maintenance' },
  { text: 'Excavator hydraulics loose at the face, not working', expectedCategory: 'maintenance' },
  { text: 'Broken conveyor belt, needs repair', expectedCategory: 'maintenance' },
  { text: 'Drill not working at the bench, needs a technician', expectedCategory: 'maintenance' },

  // SWAHILI cases — 16 (>15 required)
  { text: 'Nimekasirika sana, makato ya mrabaha yangu sio sahihi', expectedCategory: 'billing' },
  { text: 'Tafadhali, malipo batili ya mwezi huu', expectedCategory: 'billing' },
  { text: 'Nina swali kuhusu mkataba wangu, kifungu cha kuvunja mkataba', expectedCategory: 'contract-question' },
  { text: 'Kifungu cha mkataba sicho wazi, naomba ufafanuzi', expectedCategory: 'contract-question' },
  { text: 'Vumbi kutoka eneo la mgodi kila siku, kelele za mlipuko', expectedCategory: 'community' },
  { text: 'Maji yamechafuliwa chini ya mto, mtetemo wa milipuko', expectedCategory: 'community' },
  { text: 'Mlinzi aliingia bila taarifa eneo langu', expectedCategory: 'privacy', expectedSeverityAtLeast: 'urgent' },
  { text: 'Nasikia kuna ubaguzi kutoka kwa msimamizi, sina haki', expectedCategory: 'fair-treatment', expectedSeverityAtLeast: 'urgent' },
  { text: 'Gesi inavuja shimoni, hatari ya maisha, haraka', expectedCategory: 'safety', expectedSeverityAtLeast: 'critical' },
  { text: 'Sijihisi salama hapa, tishio kutoka kwa mtu', expectedCategory: 'safety', expectedSeverityAtLeast: 'critical' },
  { text: 'Pampu ya maji inavuja tena, mtambo umevunjika', expectedCategory: 'maintenance' },
  { text: 'Jenereta haifanyi kazi, hakuna umeme', expectedCategory: 'maintenance' },
  { text: 'Mashine ya kusaga imevunjika, haifanyi kazi tangu jana', expectedCategory: 'maintenance' },
  { text: 'Mtambo haifanyi kazi vizuri, uzalishaji umesimama', expectedCategory: 'maintenance' },
  { text: 'Asante kwa huduma nzuri, nashukuru sana', expectedCategory: 'other', expectedSeverityAtMost: 'chatter' },
  { text: 'Tafadhali nisaidie haraka, malipo sio sahihi tena', expectedCategory: 'billing' },

  // Chatter / other — 3
  { text: 'FYI — just letting you know the gate hinge squeaks a bit', expectedCategory: 'other', expectedSeverityAtMost: 'chatter' },
  { text: 'No big deal, but the notice board is a little loose', expectedCategory: 'other', expectedSeverityAtMost: 'chatter' },
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
    const r = classifyComplaint('Tafadhali nisaidie, malipo sio sahihi, nimekasirika sana');
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
