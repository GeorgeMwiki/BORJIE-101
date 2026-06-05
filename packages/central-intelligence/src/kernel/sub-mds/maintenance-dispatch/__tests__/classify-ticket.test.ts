import { describe, expect, it } from 'vitest';
import { classifyTicket, type TicketCategory, type TicketUrgency } from '../tools/classify-ticket.js';

interface Case {
  readonly text: string;
  readonly expectedCategory: TicketCategory;
  readonly expectedUrgencyAtLeast?: TicketUrgency;
  readonly expectedUrgencyAtMost?: TicketUrgency;
  readonly note?: string;
}

const URGENCY_RANK: Record<TicketUrgency, number> = { low: 0, medium: 1, high: 2, emergency: 3 };

/**
 * 50+ labelled cases mixing English, Swahili, and noisy free-text.
 */
const CASES: ReadonlyArray<Case> = [
  // PUMPING — 10
  { text: 'Pit flooding fast, water rising in the pit', expectedCategory: 'pumping', expectedUrgencyAtLeast: 'emergency' },
  { text: 'Shimo limejaa maji, pampu kuu imekufa', expectedCategory: 'pumping', expectedUrgencyAtLeast: 'emergency' },
  { text: 'Slurry pump down at the wash plant since yesterday', expectedCategory: 'pumping', expectedUrgencyAtLeast: 'high' },
  { text: 'Pampu ya maji haifanyi, no pumping at all', expectedCategory: 'pumping', expectedUrgencyAtLeast: 'high' },
  { text: 'Borehole pump tripping intermittently', expectedCategory: 'pumping', expectedUrgencyAtLeast: 'high' },
  { text: 'Pump leak at the seal in the sump', expectedCategory: 'pumping' },
  { text: 'Pampu inavuja kwenye sili', expectedCategory: 'pumping' },
  { text: 'Pump impeller worn, low flow', expectedCategory: 'pumping' },
  { text: 'Dripping pump gland, needs attention', expectedCategory: 'pumping' },
  { text: 'Dewatering pump failed overnight, urgent', expectedCategory: 'pumping', expectedUrgencyAtLeast: 'emergency' },

  // ELECTRICAL — 8
  { text: 'Cheche za umeme zinatoka panel, hatari!', expectedCategory: 'electrical', expectedUrgencyAtLeast: 'emergency' },
  { text: 'Electrical fire at the switchgear, sparks everywhere', expectedCategory: 'electrical', expectedUrgencyAtLeast: 'emergency' },
  { text: 'Umeme umekatika site nzima', expectedCategory: 'electrical', expectedUrgencyAtLeast: 'high' },
  { text: 'No power at the plant since this morning', expectedCategory: 'electrical', expectedUrgencyAtLeast: 'high' },
  { text: 'Breaker keeps tripping on the main feeder', expectedCategory: 'electrical', expectedUrgencyAtLeast: 'high' },
  { text: 'Cable damaged in the substation', expectedCategory: 'electrical' },
  { text: 'Motor not starting on the conveyor drive', expectedCategory: 'electrical' },
  { text: 'Isolator faulty in the MCC room', expectedCategory: 'electrical' },

  // HYDRAULICS — 5
  { text: 'Hydraulic hose burst on the excavator boom', expectedCategory: 'hydraulics', expectedUrgencyAtLeast: 'high' },
  { text: 'Mafuta ya haidroliki yanavuja, ram leaking', expectedCategory: 'hydraulics', expectedUrgencyAtLeast: 'high' },
  { text: 'Boom will not lift on the loader', expectedCategory: 'hydraulics', expectedUrgencyAtLeast: 'high' },
  { text: 'Hydraulic cylinder seeping oil', expectedCategory: 'hydraulics' },
  { text: 'Hose chafing near the ram', expectedCategory: 'hydraulics' },

  // PROCESSING — 5
  { text: 'Crusher jammed, production stopped', expectedCategory: 'processing', expectedUrgencyAtLeast: 'high' },
  { text: 'Kisagaji kimekwama, ball mill stopped', expectedCategory: 'processing', expectedUrgencyAtLeast: 'high' },
  { text: 'Wash plant down, screen blocked', expectedCategory: 'processing', expectedUrgencyAtLeast: 'high' },
  { text: 'Mill liner worn on the ball mill', expectedCategory: 'processing' },
  { text: 'Conveyor belt torn at the crusher discharge', expectedCategory: 'processing' },

  // VEHICLE — 5
  { text: 'Haul truck engine overheating on the ramp', expectedCategory: 'vehicle' },
  { text: 'Excavator engine knocking, lori halifanyi', expectedCategory: 'vehicle' },
  { text: 'Loader tyre flat at the stockpile', expectedCategory: 'vehicle' },
  { text: 'Dozer not starting this morning', expectedCategory: 'vehicle' },
  { text: 'Tipper gari brakes spongy, fleet check', expectedCategory: 'vehicle' },

  // STRUCTURAL — 5
  { text: 'Ramp collapse risk, ground subsidence, urgent!', expectedCategory: 'structural', expectedUrgencyAtLeast: 'high' },
  { text: 'Retaining wall crack getting wider, ukuta umepasuka', expectedCategory: 'structural', expectedUrgencyAtLeast: 'high' },
  { text: 'Headframe member bent, big crack at the base', expectedCategory: 'structural', expectedUrgencyAtLeast: 'high' },
  { text: 'Front gate broken, will not close', expectedCategory: 'structural' },
  { text: 'Perimeter fence down near the magazine', expectedCategory: 'structural' },

  // SAFETY — 5
  { text: 'Gas detector down in the decline, methane alarm not working', expectedCategory: 'safety', expectedUrgencyAtLeast: 'high' },
  { text: 'Ventilation fan down underground, feni ya hewa imezimika', expectedCategory: 'safety', expectedUrgencyAtLeast: 'high' },
  { text: 'Fire suppression system fault on the genset', expectedCategory: 'safety', expectedUrgencyAtLeast: 'high' },
  { text: 'Emergency stop not latching on the crusher', expectedCategory: 'safety', expectedUrgencyAtLeast: 'high' },
  { text: 'Kigunduzi cha gesi hakifanyi kazi', expectedCategory: 'safety', expectedUrgencyAtLeast: 'high' },

  // GENERAL — 5
  { text: 'Signage at the gate needs a fresh coat of paint', expectedCategory: 'general', expectedUrgencyAtMost: 'medium' },
  { text: 'Rangi ya ofisi imechakaa, when possible', expectedCategory: 'general', expectedUrgencyAtMost: 'low' },
  { text: 'Housekeeping in the change house, no rush', expectedCategory: 'general', expectedUrgencyAtMost: 'low' },
  { text: 'Deep cleaning needed in the canteen', expectedCategory: 'general' },
  { text: 'Office signage faded', expectedCategory: 'general' },

  // EXTRA edge cases — 3
  { text: 'Pump dripping, no rush', expectedCategory: 'pumping', expectedUrgencyAtMost: 'low' },
  { text: 'Urgent emergency now: pit flooding from the upper bench', expectedCategory: 'pumping', expectedUrgencyAtLeast: 'emergency' },
  { text: 'Motor not starting on the screen drive', expectedCategory: 'electrical' },
];

function isAtLeast(a: TicketUrgency, b: TicketUrgency): boolean {
  return URGENCY_RANK[a] >= URGENCY_RANK[b];
}

describe('classifyTicket — accuracy harness', () => {
  it('classifies at least 85% of holdout correctly', () => {
    let hits = 0;
    const misses: Array<{ text: string; expected: TicketCategory; got: TicketCategory }> = [];
    for (const c of CASES) {
      const r = classifyTicket(c.text);
      let ok = r.category === c.expectedCategory;
      if (ok && c.expectedUrgencyAtLeast) {
        ok = isAtLeast(r.urgency, c.expectedUrgencyAtLeast);
      }
      if (ok && c.expectedUrgencyAtMost) {
        ok = !isAtLeast(r.urgency, c.expectedUrgencyAtMost) || r.urgency === c.expectedUrgencyAtMost;
      }
      if (ok) {
        hits += 1;
      } else {
        misses.push({ text: c.text, expected: c.expectedCategory, got: r.category });
      }
    }
    const accuracy = hits / CASES.length;
    if (accuracy < 0.85) {
      console.error('Holdout misses:', misses);
    }
    expect(CASES.length).toBeGreaterThanOrEqual(50);
    expect(accuracy).toBeGreaterThanOrEqual(0.85);
  });

  it('detects Swahili language on heavy-Swahili input', () => {
    const r = classifyTicket('Shimo limejaa maji, pampu kuu imekufa, tafadhali haraka');
    expect(r.detectedLanguage === 'sw' || r.detectedLanguage === 'mixed').toBe(true);
  });

  it('detects English on heavy-English input', () => {
    const r = classifyTicket('The slurry pump at the wash plant is leaking under the bearing');
    expect(r.detectedLanguage).toBe('en');
  });

  it('returns rationale and required skills', () => {
    const r = classifyTicket('Crusher jammed, production stopped fast');
    expect(r.requiredSkills.length).toBeGreaterThanOrEqual(1);
    expect(r.rationale.length).toBeGreaterThan(0);
  });
});
