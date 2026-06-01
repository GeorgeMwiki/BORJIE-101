import { describe, expect, it } from 'vitest';
import {
  classifyComplaint,
  type ComplaintCategory,
} from '../tools/classify-complaint.js';

/**
 * Dedicated Swahili-input coverage. 18 cases (>15 required).
 * Every input is primarily Swahili; classification must still be
 * correct.
 */
const SWAHILI_CASES: ReadonlyArray<{
  readonly text: string;
  readonly expected: ComplaintCategory;
}> = [
  { text: 'Makato ya mrabaha yangu sio sahihi mwezi huu', expected: 'billing' },
  { text: 'Malipo batili, nimelipwa pungufu ya inavyostahili', expected: 'billing' },
  { text: 'Rejesha pesa zangu, malipo ya awali hayajarudi', expected: 'billing' },
  { text: 'Kifungu cha mkataba sicho wazi', expected: 'contract-question' },
  { text: 'Naomba kuongeza muda wa mkataba', expected: 'contract-question' },
  { text: 'Vumbi kutoka mgodini kila siku, kelele za mlipuko', expected: 'community' },
  { text: 'Mtetemo wa milipuko hadi saa nane usiku', expected: 'community' },
  { text: 'Aliingia bila taarifa, faragha imevunjwa', expected: 'privacy' },
  { text: 'Cctv inaona ndani ya chumba cha kubadilishia, faragha', expected: 'privacy' },
  { text: 'Unyanyasaji kutoka kwa msimamizi, sina haki', expected: 'fair-treatment' },
  { text: 'Tishio la kusimamisha leseni kwa sababu sina malalamiko', expected: 'fair-treatment' },
  { text: 'Gesi inavuja shimoni, dharura', expected: 'safety' },
  { text: 'Sijihisi salama, mtu ametishia maisha yangu', expected: 'safety' },
  { text: 'Pampu linavuja tena, mtambo umevunjika', expected: 'maintenance' },
  { text: 'Mashine imevunjika, mtambo haufanyi kazi', expected: 'maintenance' },
  { text: 'Umeme umekatika tangu jana, jenereta haifanyi kazi', expected: 'maintenance' },
  { text: 'Mtambo haifanyi kazi vizuri, uzalishaji umesimama', expected: 'maintenance' },
  { text: 'Pampu haifanyi kazi tena, maji yamejaa shimoni', expected: 'maintenance' },
];

describe('Swahili-classification', () => {
  it('has at least 15 Swahili cases', () => {
    expect(SWAHILI_CASES.length).toBeGreaterThanOrEqual(15);
  });

  it('classifies at least 85% of Swahili inputs correctly', () => {
    let hits = 0;
    const misses: Array<{ text: string; expected: ComplaintCategory; got: ComplaintCategory }> = [];
    for (const c of SWAHILI_CASES) {
      const r = classifyComplaint(c.text);
      if (r.category === c.expected) hits += 1;
      else misses.push({ text: c.text, expected: c.expected, got: r.category });
    }
    const acc = hits / SWAHILI_CASES.length;
    if (acc < 0.85) console.error('Swahili misses:', misses);
    expect(acc).toBeGreaterThanOrEqual(0.85);
  });

  it('marks at least 60% of Swahili inputs as sw or mixed language', () => {
    let swHits = 0;
    for (const c of SWAHILI_CASES) {
      const r = classifyComplaint(c.text);
      if (r.detectedLanguage === 'sw' || r.detectedLanguage === 'mixed') swHits += 1;
    }
    expect(swHits / SWAHILI_CASES.length).toBeGreaterThanOrEqual(0.6);
  });
});
