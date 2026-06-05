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
  { text: 'I am a pump tech, dewatering and slurry pump overhauls', expectedTags: ['pump-tech'] },
  { text: 'Huduma za pampu — borehole pump na dewatering', expectedTags: ['pump-tech'] },
  { text: 'Electrician for site power, wiring and switchgear', expectedTags: ['electrician'] },
  { text: 'Mimi ni fundi wa umeme, ninafanya wiring', expectedTags: ['electrician'] },
  { text: 'Hydraulics technician, hose and cylinder repair', expectedTags: ['hydraulics-tech'] },
  { text: 'Mtaalam wa haidroliki, ku-service ram na hose', expectedTags: ['hydraulics-tech'] },
  { text: 'Process fitter — crusher and ball mill maintenance', expectedTags: ['process-fitter'] },
  { text: 'Fundi wa kinu, kurekebisha screen na cyclone', expectedTags: ['process-fitter'] },
  { text: 'Diesel mechanic for haul truck and excavator engines', expectedTags: ['diesel-mechanic'] },
  { text: 'Fundi wa injini za magari, loader na fleet', expectedTags: ['diesel-mechanic'] },
  { text: 'Boilermaker — welding and wear plate work', expectedTags: ['boilermaker'] },
  { text: 'Fundi wa kulehemu, plate work na fabrication chutes', expectedTags: ['boilermaker'] },
  { text: 'Rigger — crane lifting and winch operations', expectedTags: ['rigger'] },
  { text: 'Huduma za rigging na lifting kwa crane', expectedTags: ['rigger'] },
  { text: 'Civil works — concrete, retaining wall and road works', expectedTags: ['civil'] },
  { text: 'Fundi wa ujenzi, sement na culvert', expectedTags: ['civil'] },
  { text: 'Mine surveyor — pegging and GPS survey', expectedTags: ['surveyor'] },
  { text: 'Mhandisi wa upimaji, mine survey na pegging', expectedTags: ['surveyor'] },
  { text: 'Blasting contractor — shotfirer, explosives handling', expectedTags: ['blasting'] },
  { text: 'Huduma za milipuko, baruti na blast design', expectedTags: ['blasting'] },
  { text: 'Assayer — fire assay and sampling lab', expectedTags: ['assayer'] },
  { text: 'Huduma za maabara, assay na sampling', expectedTags: ['assayer'] },
  { text: 'Safety tech — ventilation, gas detection, mine rescue', expectedTags: ['safety-tech'] },
  { text: 'Huduma za usalama, fire suppression mgodini', expectedTags: ['safety-tech'] },
  { text: 'Haulage — tipper cartage and logistics', expectedTags: ['haulage'] },
  { text: 'Huduma za usafirishaji wa madini, transport', expectedTags: ['haulage'] },
  { text: 'Fabrication — sheet metal and machining workshop', expectedTags: ['fabrication'] },
  { text: 'Workshop fabricator, machining na sheet metal', expectedTags: ['fabrication'] },
  { text: 'General hand — cleaning and housekeeping at camp', expectedTags: ['general-hand'] },
  { text: 'Fundi wa kawaida, usafi wa camp', expectedTags: ['general-hand'] },

  // Multi-trade — 12
  { text: 'Pump tech and electrician — full plant services', expectedTags: ['pump-tech', 'electrician'] },
  { text: 'Civil and boilermaker combined for structural works', expectedTags: ['civil', 'boilermaker'] },
  { text: 'Haulage and general hand bundle service', expectedTags: ['haulage', 'general-hand'] },
  { text: 'Safety and surveyor — compliance services', expectedTags: ['safety-tech', 'surveyor'] },
  { text: 'Fabrication and boilermaker — workshop welding fit-out', expectedTags: ['fabrication', 'boilermaker'] },
  { text: 'Hydraulics and electrician, full systems', expectedTags: ['hydraulics-tech', 'electrician'] },
  { text: 'Pump tech and assayer — water and lab', expectedTags: ['pump-tech', 'assayer'] },
  { text: 'Civil and rigger — structural lifting works', expectedTags: ['civil', 'rigger'] },
  { text: 'Diesel mechanic and hydraulics tech — full fleet services', expectedTags: ['diesel-mechanic', 'hydraulics-tech'] },
  { text: 'General hand and haulage for site logistics', expectedTags: ['general-hand', 'haulage'] },
  { text: 'Surveyor and blasting for bench design', expectedTags: ['surveyor', 'blasting'] },
  { text: 'Fundi wa umeme na fundi wa pampu', expectedTags: ['electrician', 'pump-tech'] },

  // Emergency tag — 4
  { text: 'Pump tech, 24/7 emergency dewatering response', expectedTags: ['pump-tech'] },
  { text: 'Electrician — around the clock for emergencies', expectedTags: ['electrician'] },
  { text: 'Fundi wa dharura, ninapatikana saa zote, general hand', expectedTags: ['general-hand'] },
  { text: 'On-call hydraulics technician for emergencies', expectedTags: ['hydraulics-tech'] },

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
    const r = classifyCapabilities('Pump tech, 24/7 emergency dewatering response');
    expect(r.emergencyAvailable).toBe(true);
  });

  it('extracts service areas when present', () => {
    const r = classifyCapabilities('Pump tech. Areas: Geita, Kahama, Shinyanga');
    expect(r.serviceAreas.length).toBeGreaterThanOrEqual(1);
  });

  it('returns no tags on empty text', () => {
    const r = classifyCapabilities('Hello, looking for a job');
    expect(r.capabilityTags.length).toBe(0);
  });
});
