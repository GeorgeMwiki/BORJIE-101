import { describe, expect, it } from 'vitest';
import {
  WCAG_CHECK_REGISTRY,
  createAccessibilityScanner,
} from '../accessibility/index.js';

const scanner = createAccessibilityScanner();

function scan(html: string) {
  return scanner.checkAccessibility(html);
}

describe('WCAG_CHECK_REGISTRY', () => {
  it('ships exactly 16 checks', () => {
    expect(WCAG_CHECK_REGISTRY.length).toBe(16);
  });

  it('covers the documented WCAG 2.2 AA + Section 508 SCs we audit', () => {
    const ids = WCAG_CHECK_REGISTRY.map((c) => c.wcagSc);
    const expected = [
      '1.1.1-non-text-content',
      '1.3.1-info-and-relationships',
      '1.3.5-identify-input-purpose',
      '1.4.3-contrast-minimum',
      '1.4.10-reflow',
      '1.4.11-non-text-contrast',
      '2.1.1-keyboard',
      '2.4.3-focus-order',
      '2.4.4-link-purpose',
      '2.4.6-headings-and-labels',
      '2.4.7-focus-visible',
      '2.5.7-dragging-movements',
      '2.5.8-target-size-minimum',
      '3.2.6-consistent-help',
      '3.3.7-redundant-entry',
      '4.1.2-name-role-value',
    ];
    for (const e of expected) {
      expect(ids).toContain(e as never);
    }
  });
});

describe('accessibility checks — failure detection', () => {
  it('alt-text missing — flagged', () => {
    const r = scan('<img src="x.png">');
    const c = r.checks.find((x) => x.wcagSc === '1.1.1-non-text-content');
    expect(c?.passed).toBe(false);
  });

  it('alt-text present — passes', () => {
    const r = scan('<img src="x.png" alt="hero photo">');
    const c = r.checks.find((x) => x.wcagSc === '1.1.1-non-text-content');
    expect(c?.passed).toBe(true);
  });

  it('heading order skipped — flagged', () => {
    const r = scan('<h1>title</h1><h3>sub</h3>');
    const c = r.checks.find((x) => x.wcagSc === '2.4.6-headings-and-labels');
    expect(c?.passed).toBe(false);
  });

  it('heading order sequential — passes', () => {
    const r = scan('<h1>a</h1><h2>b</h2><h3>c</h3>');
    const c = r.checks.find((x) => x.wcagSc === '2.4.6-headings-and-labels');
    expect(c?.passed).toBe(true);
  });

  it('div with onclick — flagged (keyboard)', () => {
    const r = scan('<div onclick="x()">tap</div>');
    const c = r.checks.find((x) => x.wcagSc === '2.1.1-keyboard');
    expect(c?.passed).toBe(false);
  });

  it('outline:none without :focus-visible — flagged', () => {
    const r = scan('<style>button { outline: none; }</style>');
    const c = r.checks.find((x) => x.wcagSc === '2.4.7-focus-visible');
    expect(c?.passed).toBe(false);
  });

  it('outline:none with :focus-visible replacement — passes', () => {
    const r = scan('<style>button:focus-visible { outline: 2px solid blue; }</style>');
    const c = r.checks.find((x) => x.wcagSc === '2.4.7-focus-visible');
    expect(c?.passed).toBe(true);
  });

  it('vague link text — flagged', () => {
    const r = scan('<a href="x">click here</a>');
    const c = r.checks.find((x) => x.wcagSc === '2.4.4-link-purpose');
    expect(c?.passed).toBe(false);
  });

  it('descriptive link text — passes', () => {
    const r = scan('<a href="/privacy">Read the privacy policy</a>');
    const c = r.checks.find((x) => x.wcagSc === '2.4.4-link-purpose');
    expect(c?.passed).toBe(true);
  });

  it('user-scalable=no — flagged (reflow)', () => {
    const r = scan('<meta name="viewport" content="user-scalable=no">');
    const c = r.checks.find((x) => x.wcagSc === '1.4.10-reflow');
    expect(c?.passed).toBe(false);
  });

  it('positive tabindex — flagged (focus order)', () => {
    const r = scan('<input tabindex="2">');
    const c = r.checks.find((x) => x.wcagSc === '2.4.3-focus-order');
    expect(c?.passed).toBe(false);
  });

  it('checkAccessibility returns score with passes + failures + score', () => {
    const r = scan('<h1>ok</h1>');
    expect(r.passes + r.failures).toBe(16);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(1);
  });

  it('sensitive input missing autocomplete — flagged', () => {
    const r = scan('<input type="email" name="e">');
    const c = r.checks.find((x) => x.wcagSc === '1.3.5-identify-input-purpose');
    expect(c?.passed).toBe(false);
  });

  it('sensitive input with autocomplete — passes', () => {
    const r = scan('<input type="email" name="e" autocomplete="email">');
    const c = r.checks.find((x) => x.wcagSc === '1.3.5-identify-input-purpose');
    expect(c?.passed).toBe(true);
  });

  it('draggable element without keyboard alternative — flagged', () => {
    const r = scan('<div draggable="true">drag me</div>');
    const c = r.checks.find((x) => x.wcagSc === '2.5.7-dragging-movements');
    expect(c?.passed).toBe(false);
  });
});
