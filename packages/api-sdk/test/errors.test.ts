import { describe, expect, it } from 'vitest';
import {
  ApiSdkError,
  AuthError,
  NetworkError,
  RateLimitError,
  ServerError,
  ValidationError,
  toBorjieError,
} from '../src/index.js';

describe('toBorjieError', () => {
  it('maps 401 to AuthError', () => {
    const e = toBorjieError(
      new ApiSdkError({ status: 401, url: '/x', message: 'no', code: 'UNAUTHENTICATED' }),
    );
    expect(e).toBeInstanceOf(AuthError);
    expect(e.status).toBe(401);
  });

  it('maps 429 to RateLimitError with retryAfter when present', () => {
    const e = toBorjieError(
      new ApiSdkError({
        status: 429,
        url: '/x',
        message: 'slow',
        code: 'RATE_LIMITED',
        details: { retryAfter: 30 },
      }),
    );
    expect(e).toBeInstanceOf(RateLimitError);
    expect((e as RateLimitError).retryAfterSec).toBe(30);
  });

  it('maps 400 to ValidationError carrying issues', () => {
    const e = toBorjieError(
      new ApiSdkError({
        status: 400,
        url: '/x',
        message: 'bad',
        code: 'VALIDATION_ERROR',
        details: { issues: [{ path: 'foo', message: 'required' }] },
      }),
    );
    expect(e).toBeInstanceOf(ValidationError);
    expect((e as ValidationError).issues).toHaveLength(1);
  });

  it('maps 5xx to ServerError', () => {
    const e = toBorjieError(
      new ApiSdkError({ status: 503, url: '/x', message: 'down', code: 'SERVER_ERROR' }),
    );
    expect(e).toBeInstanceOf(ServerError);
  });

  it('maps status=0 / NETWORK_ERROR to NetworkError', () => {
    const e = toBorjieError(
      new ApiSdkError({ status: 0, url: '/x', message: 'dns', code: 'NETWORK_ERROR' }),
    );
    expect(e).toBeInstanceOf(NetworkError);
  });

  it('serialises to JSON with all canonical fields', () => {
    const e = toBorjieError(
      new ApiSdkError({
        status: 503,
        url: '/x',
        message: 'down',
        code: 'SERVER_ERROR',
        requestId: 'req_abc',
      }),
    );
    const json = e.toJSON();
    expect(json).toMatchObject({
      name: 'ServerError',
      code: 'SERVER_ERROR',
      status: 503,
      url: '/x',
      message: 'down',
      requestId: 'req_abc',
    });
    expect(typeof json['timestamp']).toBe('string');
  });
});
