/**
 * Type guards + error classes — exhaustive coverage.
 */

import { describe, it, expect } from 'vitest';
import {
  ErrorCodes,
  KNOWN_PROTOCOL_VERSIONS,
  MCPBackpressureError,
  MCPClosedError,
  MCPError,
  MCPTimeoutError,
  PROTOCOL_VERSION,
  TenantScopeError,
  isErrorResponse,
  isNotification,
  isRequest,
  isResponse,
  type MCPMessage,
} from '../types.js';

describe('protocol version', () => {
  it('PROTOCOL_VERSION is the first entry in KNOWN_PROTOCOL_VERSIONS', () => {
    expect(KNOWN_PROTOCOL_VERSIONS[0]).toBe(PROTOCOL_VERSION);
  });

  it('versions sort in descending date order', () => {
    for (let i = 1; i < KNOWN_PROTOCOL_VERSIONS.length; i++) {
      const prev = KNOWN_PROTOCOL_VERSIONS[i - 1] ?? '';
      const cur = KNOWN_PROTOCOL_VERSIONS[i] ?? '';
      expect(prev > cur).toBe(true);
    }
  });
});

describe('type guards', () => {
  const req: MCPMessage = { jsonrpc: '2.0', id: 1, method: 'initialize' };
  const res: MCPMessage = { jsonrpc: '2.0', id: 1, result: {} };
  const err: MCPMessage = {
    jsonrpc: '2.0',
    id: 1,
    error: { code: -32601, message: 'not found' },
  };
  const not: MCPMessage = { jsonrpc: '2.0', method: 'notifications/initialized' };

  it('classifies each variant exclusively', () => {
    expect(isRequest(req)).toBe(true);
    expect(isResponse(req)).toBe(false);
    expect(isErrorResponse(req)).toBe(false);
    expect(isNotification(req)).toBe(false);

    expect(isResponse(res)).toBe(true);
    expect(isRequest(res)).toBe(false);

    expect(isErrorResponse(err)).toBe(true);
    expect(isResponse(err)).toBe(false);

    expect(isNotification(not)).toBe(true);
    expect(isRequest(not)).toBe(false);
  });
});

describe('errors', () => {
  it('all carry MCPError lineage + code', () => {
    expect(new MCPBackpressureError()).toBeInstanceOf(MCPError);
    expect(new MCPClosedError()).toBeInstanceOf(MCPError);
    expect(new MCPTimeoutError('x', 100).code).toBe(ErrorCodes.RequestTimeout);
    const t = new TenantScopeError('mismatch', 't-bad', 't-good');
    expect(t.code).toBe(ErrorCodes.TenantScopeViolation);
    expect(t.attemptedTenant).toBe('t-bad');
    expect(t.sessionTenant).toBe('t-good');
  });

  it('MCPTimeoutError includes method + duration in message', () => {
    const e = new MCPTimeoutError('tools/call', 30_000);
    expect(e.message).toContain('tools/call');
    expect(e.message).toContain('30000');
  });
});
