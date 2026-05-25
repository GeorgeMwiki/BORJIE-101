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
  // PLUMBING — 10
  { text: 'Water main burst in the basement, flooding fast', expectedCategory: 'plumbing', expectedUrgencyAtLeast: 'emergency' },
  { text: 'Bomba kuu limepasuka, maji mengi yanavuja sana', expectedCategory: 'plumbing', expectedUrgencyAtLeast: 'emergency' },
  { text: 'No hot water in the apartment since yesterday', expectedCategory: 'plumbing', expectedUrgencyAtLeast: 'high' },
  { text: 'Hakuna maji ya moto tangu jana', expectedCategory: 'plumbing', expectedUrgencyAtLeast: 'high' },
  { text: 'Kitchen sink is leaking under the cabinet', expectedCategory: 'plumbing' },
  { text: 'Choo kimeziba tena, tafadhali nisaidie', expectedCategory: 'plumbing' },
  { text: 'Toilet blocked, water rising', expectedCategory: 'plumbing' },
  { text: 'Mfereji wa bafu unavuja, samahani', expectedCategory: 'plumbing' },
  { text: 'Dripping tap in master bathroom for two weeks', expectedCategory: 'plumbing' },
  { text: 'Water heater not working, hakuna maji ya moto', expectedCategory: 'plumbing', expectedUrgencyAtLeast: 'high' },

  // ELECTRICAL — 8
  { text: 'Cheche za umeme zinatoka sketi, hatari!', expectedCategory: 'electrical', expectedUrgencyAtLeast: 'emergency' },
  { text: 'Electrical fire in the kitchen socket, sparks everywhere', expectedCategory: 'electrical', expectedUrgencyAtLeast: 'emergency' },
  { text: 'Umeme umekatika ghorofa nzima', expectedCategory: 'electrical', expectedUrgencyAtLeast: 'high' },
  { text: 'No power in the building since this morning', expectedCategory: 'electrical', expectedUrgencyAtLeast: 'high' },
  { text: 'Breaker keeps tripping every time I use the kettle', expectedCategory: 'electrical', expectedUrgencyAtLeast: 'high' },
  { text: 'Bulb in living room burned out', expectedCategory: 'electrical' },
  { text: 'Taa ya jikoni haifanyi kazi', expectedCategory: 'electrical' },
  { text: 'Plug socket loose in bedroom', expectedCategory: 'electrical' },

  // HVAC / GAS — 5
  { text: 'I smell gas in the kitchen, harufu kali ya gesi', expectedCategory: 'hvac', expectedUrgencyAtLeast: 'high' },
  { text: 'Gas leak from the cooker, very strong smell', expectedCategory: 'hvac', expectedUrgencyAtLeast: 'high' },
  { text: 'AC not cooling at all, very hot', expectedCategory: 'hvac' },
  { text: 'Kiyoyozi hakifanyi kazi tena', expectedCategory: 'hvac' },
  { text: 'Heater not working in bedroom', expectedCategory: 'hvac' },

  // APPLIANCE — 5
  { text: 'Fridge not cooling, food going bad', expectedCategory: 'appliance' },
  { text: 'Friji haifanyi kazi vizuri, chakula kinaharibika', expectedCategory: 'appliance' },
  { text: 'Oven not heating up', expectedCategory: 'appliance' },
  { text: 'Washing machine making strange noise', expectedCategory: 'appliance' },
  { text: 'Microwave stopped working completely', expectedCategory: 'appliance' },

  // STRUCTURAL — 5
  { text: 'Ceiling collapsed in the hallway, urgent!', expectedCategory: 'structural', expectedUrgencyAtLeast: 'high' },
  { text: 'Paa limeanguka ukumbini, haraka tafadhali', expectedCategory: 'structural', expectedUrgencyAtLeast: 'high' },
  { text: 'Big crack in the wall, getting wider', expectedCategory: 'structural', expectedUrgencyAtLeast: 'high' },
  { text: 'Front door broken, will not close', expectedCategory: 'structural' },
  { text: 'Dirisha la bafu limevunjika', expectedCategory: 'structural' },

  // PEST — 5
  { text: 'Lots of cockroaches in the kitchen', expectedCategory: 'pest' },
  { text: 'Mende wengi sana jikoni', expectedCategory: 'pest' },
  { text: 'Rats in the storeroom, panya wameingia', expectedCategory: 'pest' },
  { text: 'Bedbugs in the bedroom, kunguni wamenikalia', expectedCategory: 'pest' },
  { text: 'Termite damage in the wooden floor, mchwa', expectedCategory: 'pest' },

  // COSMETIC — 5
  { text: 'Wall needs a fresh coat of paint', expectedCategory: 'cosmetic', expectedUrgencyAtMost: 'medium' },
  { text: 'Rangi ya ukuta imechakaa, when possible', expectedCategory: 'cosmetic', expectedUrgencyAtMost: 'low' },
  { text: 'Scuff mark on living room wall', expectedCategory: 'cosmetic', expectedUrgencyAtMost: 'medium' },
  { text: 'Deep cleaning needed in apartment', expectedCategory: 'cosmetic' },
  { text: 'Doa ukutani la kahawa', expectedCategory: 'cosmetic' },

  // SECURITY — 5
  { text: 'There was a break-in last night, lock broken', expectedCategory: 'security', expectedUrgencyAtLeast: 'high' },
  { text: 'Lango la mbele limevunjika, hatari', expectedCategory: 'security', expectedUrgencyAtLeast: 'high' },
  { text: 'CCTV camera in the corridor not working', expectedCategory: 'security' },
  { text: 'Alarm system keeps going off randomly', expectedCategory: 'security' },
  { text: 'Wameingia ndani, broken lock kwa mlango wa nyuma', expectedCategory: 'security', expectedUrgencyAtLeast: 'high' },

  // EXTRA edge cases — 3
  { text: 'Tap dripping, no rush', expectedCategory: 'plumbing', expectedUrgencyAtMost: 'low' },
  { text: 'Urgent emergency now: flooding apartment from upstairs', expectedCategory: 'plumbing', expectedUrgencyAtLeast: 'emergency' },
  { text: 'Lights flickering on and off in hallway', expectedCategory: 'electrical' },
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
    const r = classifyTicket('Bomba kuu limepasuka, maji mengi yanavuja sana, tafadhali haraka');
    expect(r.detectedLanguage === 'sw' || r.detectedLanguage === 'mixed').toBe(true);
  });

  it('detects English on heavy-English input', () => {
    const r = classifyTicket('The kitchen sink in the apartment is leaking under the cabinet');
    expect(r.detectedLanguage).toBe('en');
  });

  it('returns rationale and required skills', () => {
    const r = classifyTicket('Toilet blocked, water rising fast');
    expect(r.requiredSkills.length).toBeGreaterThanOrEqual(1);
    expect(r.rationale.length).toBeGreaterThan(0);
  });
});
