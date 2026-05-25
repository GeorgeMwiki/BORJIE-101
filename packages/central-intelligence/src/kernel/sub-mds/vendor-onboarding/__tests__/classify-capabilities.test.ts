import { describe, expect, it } from 'vitest';
import {
  classifyCapabilities,
  type CapabilityTag,
} from '../tools/classify-capabilities.js';

interface Case {
  readonly text: string;
  readonly expectedTags: ReadonlyArray<CapabilityTag>;
  readonly note?: string;
}

const CASES: ReadonlyArray<Case> = [
  // Single-trade — 30
  { text: 'I am a plumber, fixing taps, sinks and toilets', expectedTags: ['plumber'] },
  { text: 'Plumbing services — bomba na mfereji', expectedTags: ['plumber'] },
  { text: 'Electrician for residential properties, wiring and breakers', expectedTags: ['electrician'] },
  { text: 'Mimi ni fundi wa umeme, ninafanya wiring', expectedTags: ['electrician'] },
  { text: 'HVAC technician, aircon installation and servicing', expectedTags: ['hvac-tech'] },
  { text: 'Mimi ni mtaalam wa kiyoyozi, kuweka na ku-service', expectedTags: ['hvac-tech'] },
  { text: 'Gas fitter — LPG cylinder installation and leak repair', expectedTags: ['gas-fitter'] },
  { text: 'Fundi wa gesi, ufungaji wa LPG cylinder', expectedTags: ['gas-fitter'] },
  { text: 'Mason specialising in plastering and concrete work', expectedTags: ['mason'] },
  { text: 'Fundi wa ujenzi, plastering na sement', expectedTags: ['mason'] },
  { text: 'Handyman — general repairs, fixing things around the house', expectedTags: ['handyman'] },
  { text: 'Fundi wa kawaida, ku-fix vitu vya nyumbani', expectedTags: ['handyman'] },
  { text: 'Painter — wall painting interior and exterior', expectedTags: ['painter'] },
  { text: 'Mfanyikazi wa rangi, kupaka rangi za nyumba', expectedTags: ['painter'] },
  { text: 'Cleaning services — deep cleaning of apartments', expectedTags: ['cleaner'] },
  { text: 'Huduma za usafi, kufanya usafi wa nyumba', expectedTags: ['cleaner'] },
  { text: 'Pest control — fumigation against mende, panya, kunguni', expectedTags: ['pest-control'] },
  { text: 'Ku-control wadudu wa nyumbani, fumigation', expectedTags: ['pest-control'] },
  { text: 'Locksmith — lock and key repair, master keys', expectedTags: ['locksmith'] },
  { text: 'Kurekebisha kufuli na funguo za nyumba', expectedTags: ['locksmith'] },
  { text: 'Security installations — CCTV, alarm, access control', expectedTags: ['security'] },
  { text: 'Huduma za usalama, ufungaji wa CCTV', expectedTags: ['security'] },
  { text: 'Appliance technician — fridge, oven, washing machine', expectedTags: ['appliance-tech'] },
  { text: 'Fundi wa friji na jiko', expectedTags: ['appliance-tech'] },
  { text: 'Roofer — roofing repair and replacement, paa la nyumba', expectedTags: ['roofer'] },
  { text: 'Mfanyikazi wa paa, kurekebisha paa la nyumba', expectedTags: ['roofer'] },
  { text: 'Landscaper — gardening, lawn maintenance, planting', expectedTags: ['landscaper'] },
  { text: 'Mtu wa bustani, kupanda miti na kukata nyasi', expectedTags: ['landscaper'] },
  { text: 'Carpenter — custom furniture and built-ins', expectedTags: ['carpenter'] },
  { text: 'Seremala, samani za kawaida na za maalum', expectedTags: ['carpenter'] },

  // Multi-trade — 12
  { text: 'Plumber and electrician — full property services', expectedTags: ['plumber', 'electrician'] },
  { text: 'Painter and mason combined for renovation jobs', expectedTags: ['painter', 'mason'] },
  { text: 'Cleaning and pest control bundle service', expectedTags: ['cleaner', 'pest-control'] },
  { text: 'Security and locksmith — full access services', expectedTags: ['security', 'locksmith'] },
  { text: 'Carpenter and painter — interior fit-out specialist', expectedTags: ['carpenter', 'painter'] },
  { text: 'HVAC and electrical, full systems', expectedTags: ['hvac-tech', 'electrician'] },
  { text: 'Plumber and gas fitter — water and gas systems', expectedTags: ['plumber', 'gas-fitter'] },
  { text: 'Mason and roofer — structural works', expectedTags: ['mason', 'roofer'] },
  { text: 'Appliance and HVAC tech — full kitchen and aircon services', expectedTags: ['appliance-tech', 'hvac-tech'] },
  { text: 'Handyman and painter for small jobs', expectedTags: ['handyman', 'painter'] },
  { text: 'Landscaper and cleaner for outdoor + indoor', expectedTags: ['landscaper', 'cleaner'] },
  { text: 'Fundi wa umeme na fundi wa mfereji', expectedTags: ['electrician', 'plumber'] },

  // Emergency tag — 4
  { text: 'Plumber, 24/7 emergency response', expectedTags: ['plumber'] },
  { text: 'Electrician — around the clock for emergencies', expectedTags: ['electrician'] },
  { text: 'Fundi wa dharura, ninapatikana saa zote', expectedTags: ['handyman'] },
  { text: 'On-call HVAC technician for emergencies', expectedTags: ['hvac-tech'] },

  // Empty / unclassifiable — 4
  { text: 'I do many things', expectedTags: [] },
  { text: 'Mimi nina ujuzi mwingi', expectedTags: [] },
  { text: 'Hello, looking for a job', expectedTags: [] },
  { text: 'Asante kwa muda wenu', expectedTags: [] },
];

describe('classifyCapabilities — accuracy harness', () => {
  it('detects ≥85% of expected tags', () => {
    let hits = 0;
    let totalExpected = 0;
    const misses: Array<{ text: string; missing: ReadonlyArray<CapabilityTag>; got: ReadonlyArray<CapabilityTag> }> = [];
    for (const c of CASES) {
      const r = classifyCapabilities(c.text);
      const expectedSet = new Set<CapabilityTag>(c.expectedTags);
      const gotSet = new Set<CapabilityTag>(r.capabilityTags);
      const missing: CapabilityTag[] = [];
      for (const t of expectedSet) {
        if (gotSet.has(t)) hits += 1;
        else missing.push(t);
        totalExpected += 1;
      }
      if (missing.length > 0) misses.push({ text: c.text, missing, got: r.capabilityTags });
    }
    // Accuracy denominator = expected-tag count; empty-expected cases
    // contribute 0/0 (skipped). Use a separate empty-case check below.
    const accuracy = totalExpected > 0 ? hits / totalExpected : 1;
    if (accuracy < 0.85) console.error('Capability misses:', misses);
    expect(CASES.length).toBeGreaterThanOrEqual(50);
    expect(accuracy).toBeGreaterThanOrEqual(0.85);
  });

  it('detects emergency on-call', () => {
    const r = classifyCapabilities('Plumber, 24/7 emergency response');
    expect(r.emergencyAvailable).toBe(true);
  });

  it('extracts service areas when present', () => {
    const r = classifyCapabilities('Plumber. Areas: Kilimani, Westlands, Kileleshwa');
    expect(r.serviceAreas.length).toBeGreaterThanOrEqual(1);
  });

  it('returns no tags on empty text', () => {
    const r = classifyCapabilities('Hello, looking for a job');
    expect(r.capabilityTags.length).toBe(0);
  });
});
