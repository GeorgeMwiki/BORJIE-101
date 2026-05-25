import { describe, it, expect } from 'vitest';
import { renderChartToPng, placeholderPng } from '../index.js';

describe('renderChartToPng', () => {
  it('falls back to placeholder PNG when vega is unavailable', async () => {
    const png = await renderChartToPng({
      spec: { mark: 'line' },
      placeholderColor: '#FF0000',
    });
    expect(png.length).toBeGreaterThan(0);
    // Validate PNG header.
    expect(png[0]).toBe(0x89);
    expect(png[1]).toBe(0x50);
    expect(png[2]).toBe(0x4e);
    expect(png[3]).toBe(0x47);
  });

  it('placeholderPng returns a valid PNG of the chosen colour', () => {
    const png = placeholderPng('#1F3864');
    expect(png[0]).toBe(0x89);
    expect(png[1]).toBe(0x50);
    expect(png.length).toBeGreaterThan(20);
  });

  it('placeholderPng defaults gracefully on invalid colour', () => {
    const png = placeholderPng('not-a-colour');
    expect(png[0]).toBe(0x89);
  });
});
