/**
 * result-mapper unit tests.
 *
 * Verifies the SDK → kernel envelope conversion.
 */
import { describe, expect, it } from 'vitest';
import { mapMcpResult } from '../invocation/result-mapper.js';

describe('mapMcpResult', () => {
  it('maps a text block to a text content entry', () => {
    const result = mapMcpResult({
      content: [{ type: 'text', text: 'hello' }],
    });
    expect(result.ok).toBe(true);
    expect(result.content[0]).toEqual({ type: 'text', text: 'hello' });
  });

  it('returns ok=false when isError is set', () => {
    const result = mapMcpResult({
      isError: true,
      content: [{ type: 'text', text: 'auth failed' }],
    });
    expect(result.ok).toBe(false);
    expect(result.errorMessage).toBe('auth failed');
  });

  it('uses a generic message when isError is set without a text block', () => {
    const result = mapMcpResult({ isError: true });
    expect(result.ok).toBe(false);
    expect(result.errorMessage).toBe('MCP server returned isError');
  });

  it('passes structured content through as a json block', () => {
    const result = mapMcpResult({
      content: [],
      structuredContent: { count: 42 },
    });
    expect(result.ok).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toEqual({
      type: 'json',
      value: { count: 42 },
    });
  });

  it('drops unknown / malformed blocks rather than crashing', () => {
    const result = mapMcpResult({
      content: [{ type: 'unknown-type', text: 'x' }, null, 'string-block'],
    });
    expect(result.ok).toBe(true);
    expect(result.content).toHaveLength(0);
  });

  it('handles missing content array', () => {
    const result = mapMcpResult({});
    expect(result.ok).toBe(true);
    expect(result.content).toHaveLength(0);
  });
});
