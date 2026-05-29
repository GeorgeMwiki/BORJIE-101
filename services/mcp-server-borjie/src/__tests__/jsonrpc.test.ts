import { describe, it, expect } from 'vitest';
import {
  parseJsonRpcLine,
  isJsonRpcRequest,
  buildError,
  buildSuccess,
} from '../jsonrpc.js';

describe('parseJsonRpcLine', () => {
  it('parses a valid request', () => {
    const r = parseJsonRpcLine('{"jsonrpc":"2.0","id":1,"method":"x"}');
    expect(r).not.toBeNull();
    expect(r?.method).toBe('x');
  });
  it('returns null on garbage', () => {
    expect(parseJsonRpcLine('not json')).toBeNull();
  });
  it('returns null on missing fields', () => {
    expect(parseJsonRpcLine('{}')).toBeNull();
  });
});

describe('isJsonRpcRequest', () => {
  it('rejects non-objects', () => {
    expect(isJsonRpcRequest('x')).toBe(false);
    expect(isJsonRpcRequest(null)).toBe(false);
  });
});

describe('builders', () => {
  it('builds success', () => {
    const r = buildSuccess(7, { a: 1 });
    expect(r.result).toEqual({ a: 1 });
    expect(r.id).toBe(7);
  });
  it('builds error', () => {
    const r = buildError(8, -32601, 'no method');
    expect(r.error.code).toBe(-32601);
  });
});
