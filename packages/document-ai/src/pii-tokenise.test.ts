import { describe, it, expect } from 'vitest';
import {
  tokenisePii,
  restorePii,
  createPiiTokeniser,
} from './pii-tokenise.js';

describe('tokenisePii / restorePii', () => {
  it('tokenises PII before egress and restores it losslessly', () => {
    const text =
      'Email john@acme.co.tz, phone 0712345678, NIDA 19880101-12345-12345-12.';
    const { text: masked, map } = tokenisePii(text);
    expect(masked).not.toContain('john@acme.co.tz');
    expect(masked).not.toContain('0712345678');
    expect(masked).not.toContain('19880101-12345-12345-12');
    expect(masked).toContain('[EMAIL_1]');
    expect(masked).toContain('[PHONE_1]');
    expect(masked).toContain('[NIDA_1]');
    expect(restorePii(masked, map)).toBe(text);
  });

  it('gives the same value the same token (dedup)', () => {
    const { text: masked, map } = tokenisePii('a@x.com and a@x.com');
    expect(masked).toBe('[EMAIL_1] and [EMAIL_1]');
    expect(map.size).toBe(1);
  });

  it('leaves non-PII text untouched', () => {
    const text = 'The royalty rate is 6% on 1200 tonnes this quarter.';
    expect(tokenisePii(text).text).toBe(text);
  });

  it('restores PII inside a model answer (the egress→ingress roundtrip)', () => {
    const { map } = tokenisePii('Contact: jane@m.co');
    const modelAnswer = 'The contact email is [EMAIL_1].';
    expect(restorePii(modelAnswer, map)).toBe('The contact email is jane@m.co.');
  });

  it('keeps tokens globally unique across chunks (stateful)', () => {
    const t = createPiiTokeniser();
    const c1 = t.tokenise('chunk one: p@a.com');
    const c2 = t.tokenise('chunk two: q@b.com');
    expect(c1).toContain('[EMAIL_1]');
    expect(c2).toContain('[EMAIL_2]'); // NOT a colliding [EMAIL_1]
    expect(t.map.size).toBe(2);
    expect(restorePii(`${c1} ${c2}`, t.map)).toBe(
      'chunk one: p@a.com chunk two: q@b.com',
    );
  });
});
