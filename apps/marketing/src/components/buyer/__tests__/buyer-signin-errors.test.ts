import { describe, expect, it } from 'vitest';

import { getMessages } from '@/lib/i18n';
import {
  classifySignInError,
  messageForSignInCode,
  type SignInErrorCode,
} from '../buyer-signin-errors';

describe('buyer-signin-errors · classify', () => {
  it('classifies rate-limit by status or code', () => {
    expect(classifySignInError({ status: 429 })).toBe('too_many_attempts');
    expect(
      classifySignInError({ code: 'over_request_rate_limit' }),
    ).toBe('too_many_attempts');
  });

  it('classifies invalid credentials by status or code', () => {
    // The classic Supabase "Invalid login credentials" comes back as a 400.
    expect(
      classifySignInError({
        status: 400,
        message: 'Invalid login credentials',
      }),
    ).toBe('invalid_credentials');
    expect(classifySignInError({ code: 'invalid_credentials' })).toBe(
      'invalid_credentials',
    );
    expect(classifySignInError({ code: 'invalid_grant' })).toBe(
      'invalid_credentials',
    );
  });

  it('falls back to unknown for anything else', () => {
    expect(classifySignInError({ status: 503 })).toBe('unknown');
    expect(classifySignInError({})).toBe('unknown');
    expect(classifySignInError({ code: 'weird_provider_thing' })).toBe(
      'unknown',
    );
  });

  it('never inspects the free-text message to classify', () => {
    // A 503 with credential-flavoured prose must NOT become invalid_credentials
    // — only the structured status/code drives the branch.
    expect(
      classifySignInError({
        status: 503,
        message: 'Invalid login credentials',
      }),
    ).toBe('unknown');
  });
});

describe('buyer-signin-errors · code mapping', () => {
  const en = getMessages('en').buyerSignInPage.errors;
  const sw = getMessages('sw').buyerSignInPage.errors;

  it('maps each code to localized copy per locale', () => {
    expect(messageForSignInCode('invalid_credentials', en)).toBe(
      en.invalidCredentials,
    );
    expect(messageForSignInCode('invalid_credentials', sw)).toBe(
      sw.invalidCredentials,
    );
    expect(messageForSignInCode('too_many_attempts', en)).toBe(
      en.tooManyAttempts,
    );
    expect(messageForSignInCode('too_many_attempts', sw)).toBe(
      sw.tooManyAttempts,
    );
  });

  it('falls back to the localized generic for unknown (never a raw string)', () => {
    expect(messageForSignInCode('unknown', en)).toBe(en.signInFailed);
    expect(messageForSignInCode('unknown', sw)).toBe(sw.signInFailed);
  });

  it('never returns the raw provider message for any code', () => {
    const raw = 'Invalid login credentials';
    const codes: readonly SignInErrorCode[] = [
      'invalid_credentials',
      'too_many_attempts',
      'unknown',
    ];
    for (const code of codes) {
      expect(messageForSignInCode(code, en)).not.toBe(raw);
      expect(messageForSignInCode(code, sw)).not.toBe(raw);
    }
  });

  it('sw and en copy differ (real translations, no en leak under sw)', () => {
    expect(sw.invalidCredentials).not.toBe(en.invalidCredentials);
    expect(sw.tooManyAttempts).not.toBe(en.tooManyAttempts);
    expect(sw.signInFailed).not.toBe(en.signInFailed);
  });
});
