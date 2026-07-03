import { describe, expect, it } from 'vitest';

import { getMessages } from '@/lib/i18n';
import {
  isSignUpErrorCode,
  messageForCode,
} from '../owner-signup-errors';

describe('owner-signup-errors · code mapping', () => {
  const en = getMessages('en').ownerSignUpPage.errors;
  const sw = getMessages('sw').ownerSignUpPage.errors;

  it('maps each known gateway code to localized copy per locale', () => {
    expect(messageForCode('email_already_registered', en)).toBe(
      en.emailAlreadyRegistered,
    );
    expect(messageForCode('email_already_registered', sw)).toBe(
      sw.emailAlreadyRegistered,
    );
    expect(messageForCode('phone_already_registered', sw)).toBe(
      sw.phoneAlreadyRegistered,
    );
    expect(messageForCode('country_not_available', sw)).toBe(
      sw.countryNotAvailable,
    );
    expect(messageForCode('auth_provider_unavailable', sw)).toBe(
      sw.authProviderUnavailable,
    );
    expect(messageForCode('invalid_body', sw)).toBe(sw.invalidBody);
  });

  it('falls back to the localized generic for unknown codes (never a raw string)', () => {
    expect(messageForCode('unknown', en)).toBe(en.signUpFailed);
    expect(messageForCode('unknown', sw)).toBe(sw.signUpFailed);
  });

  it('sw and en copy differ (real translations, no en leak under sw)', () => {
    expect(sw.emailAlreadyRegistered).not.toBe(en.emailAlreadyRegistered);
    expect(sw.authProviderUnavailable).not.toBe(en.authProviderUnavailable);
    expect(sw.invalidBody).not.toBe(en.invalidBody);
  });

  it('isSignUpErrorCode narrows only to known codes', () => {
    expect(isSignUpErrorCode('email_already_registered')).toBe(true);
    expect(isSignUpErrorCode('invalid_body')).toBe(true);
    expect(isSignUpErrorCode('unknown')).toBe(true);
    // A raw provider string is NOT a known code — it must never pass.
    expect(isSignUpErrorCode('an account with this email already exists')).toBe(
      false,
    );
    expect(isSignUpErrorCode('tenant_write_failed')).toBe(false);
    expect(isSignUpErrorCode(42)).toBe(false);
  });
});
