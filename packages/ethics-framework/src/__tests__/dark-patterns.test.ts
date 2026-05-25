import { describe, expect, it } from 'vitest';
import {
  BRIGNULL_TAXONOMY,
  createDarkPatternDetector,
} from '../dark-pattern-detector/index.js';

const detector = createDarkPatternDetector();

function scan(html = '', copy = '', flow = '') {
  return detector.scanComponent({ html, copy, flow });
}

describe('Brignull taxonomy', () => {
  it('ships exactly 14 canonical categories', () => {
    expect(BRIGNULL_TAXONOMY.length).toBe(14);
  });
  it('all type ids are unique', () => {
    const ids = BRIGNULL_TAXONOMY.map((t) => t.type);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('detector — positive detection for each of 14 types', () => {
  it('sneaking — pre-checked opt-in', () => {
    const found = scan(`<input type="checkbox" checked name="newsletter">`);
    expect(found.some((d) => d.type === 'sneaking')).toBe(true);
  });

  it('urgency — countdown copy', () => {
    const found = scan('', 'Hurry — offer expires in 5 minutes');
    expect(found.some((d) => d.type === 'urgency')).toBe(true);
  });

  it('misdirection — prominent CTA vs tiny decline', () => {
    const html = `
      <button class="btn-primary">Yes, subscribe</button>
      <a>No thanks</a>
    `;
    const found = scan(html);
    expect(found.some((d) => d.type === 'misdirection')).toBe(true);
  });

  it('social-proof — fabricated live count', () => {
    const found = scan('', '104 people just bought this');
    expect(found.some((d) => d.type === 'social-proof')).toBe(true);
  });

  it('scarcity — only N left language', () => {
    const found = scan('', 'Only 2 left at this price');
    expect(found.some((d) => d.type === 'scarcity')).toBe(true);
  });

  it('obstruction — cancel only by phone', () => {
    const found = scan('', '', 'Cancellation only via phone call to support');
    expect(found.some((d) => d.type === 'obstruction')).toBe(true);
  });

  it('forced-action — coerced marketing opt-in', () => {
    const found = scan('', 'You must agree to marketing to continue');
    expect(found.some((d) => d.type === 'forced-action')).toBe(true);
  });

  it('roach-motel — easy signup, hard cancel', () => {
    const found = scan(
      '',
      '',
      'one-click sign-up; multiple steps to cancel',
    );
    expect(found.some((d) => d.type === 'roach-motel')).toBe(true);
  });

  it('privacy-zuckering — share-all language', () => {
    const found = scan('', 'Share all my contacts to find friends');
    expect(found.some((d) => d.type === 'privacy-zuckering')).toBe(true);
  });

  it('price-comparison-prevention — month price + annual-only billing', () => {
    const found = scan('', '$5 per month', 'annual plan only');
    expect(found.some((d) => d.type === 'price-comparison-prevention')).toBe(true);
  });

  it('hidden-costs — fee at checkout', () => {
    const found = scan('', '$3 service fee applies', 'shown at checkout');
    expect(found.some((d) => d.type === 'hidden-costs')).toBe(true);
  });

  it('bait-and-switch — close button triggers signup', () => {
    const html = `<button>Cancel</button>`;
    const flow = 'cancel button triggers subscribe';
    const found = scan(html, '', flow);
    expect(found.some((d) => d.type === 'bait-and-switch')).toBe(true);
  });

  it('confirmshaming — guilt-tripping decline label', () => {
    const found = scan('', 'No thanks, I do not want to save money');
    expect(found.some((d) => d.type === 'confirmshaming')).toBe(true);
  });

  it('disguised-ads — sponsored div without aria-label', () => {
    const html = `<div class="sponsored">Download now</div>`;
    const found = scan(html);
    expect(found.some((d) => d.type === 'disguised-ads')).toBe(true);
  });
});

describe('detector — clean inputs produce zero findings', () => {
  it('empty input', () => {
    expect(scan().length).toBe(0);
  });

  it('a benign label + unchecked checkbox', () => {
    const html = `<label><input type="checkbox" name="ok"> I agree</label>`;
    expect(scan(html, 'I agree to the policy').length).toBe(0);
  });
});
