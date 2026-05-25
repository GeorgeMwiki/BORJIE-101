import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { MpesaStkPush } from '../mpesa/stk-push';

describe('MpesaStkPush', () => {
  let mpesa: MpesaStkPush;

  beforeEach(() => {
    mpesa = new MpesaStkPush({
      consumerKey: 'test-key',
      consumerSecret: 'test-secret',
      passkey: 'test-passkey',
      shortcode: '174379',
      callbackUrl: 'https://example.com/callback',
      environment: 'sandbox',
    });
  });

  describe('formatPhoneNumber', () => {
    it('formats 0-prefixed phone to 254 format', () => {
      const formatted = (mpesa as any).formatPhoneNumber('0712345678');
      expect(formatted).toBe('254712345678');
    });

    it('formats +254 phone to 254 format', () => {
      const formatted = (mpesa as any).formatPhoneNumber('+254712345678');
      expect(formatted).toBe('254712345678');
    });

    it('passes through 254-prefixed phone', () => {
      const formatted = (mpesa as any).formatPhoneNumber('254712345678');
      expect(formatted).toBe('254712345678');
    });

    it('strips non-digit characters', () => {
      const formatted = (mpesa as any).formatPhoneNumber('+254 712-345-678');
      expect(formatted).toBe('254712345678');
    });

    it('handles plain number without country code', () => {
      const formatted = (mpesa as any).formatPhoneNumber('712345678');
      expect(formatted).toBe('254712345678');
    });
  });

  describe('generatePassword', () => {
    it('generates base64 encoded password', () => {
      const { password, timestamp } = (mpesa as any).generatePassword();
      expect(password).toBeTruthy();
      expect(typeof password).toBe('string');
      expect(timestamp).toMatch(/^\d{14}$/);
    });
  });

  describe('isSuccessful', () => {
    it('returns true for result code 0', () => {
      expect(mpesa.isSuccessful('0')).toBe(true);
    });

    it('returns false for non-zero result codes', () => {
      expect(mpesa.isSuccessful('1')).toBe(false);
      expect(mpesa.isSuccessful('1032')).toBe(false);
      expect(mpesa.isSuccessful('2001')).toBe(false);
    });
  });

  describe('getResultMessage', () => {
    it('returns human-readable message for known codes', () => {
      expect(mpesa.getResultMessage('0')).toBe('Transaction successful');
      expect(mpesa.getResultMessage('1')).toBe('Insufficient balance / insufficient funds');
      expect(mpesa.getResultMessage('1032')).toBe('Transaction cancelled by user');
      expect(mpesa.getResultMessage('1037')).toBe('Timeout waiting for user input');
      expect(mpesa.getResultMessage('2001')).toBe('Wrong PIN entered');
    });

    it('returns generic message for unknown codes', () => {
      expect(mpesa.getResultMessage('9999')).toContain('Unknown error');
      expect(mpesa.getResultMessage('9999')).toContain('9999');
    });
  });

  describe('constructor environment resolution', () => {
    const ORIGINAL_ENV = process.env.MPESA_ENVIRONMENT;
    beforeEach(() => {
      delete process.env.MPESA_ENVIRONMENT;
    });
    afterAll(() => {
      if (ORIGINAL_ENV === undefined) delete process.env.MPESA_ENVIRONMENT;
      else process.env.MPESA_ENVIRONMENT = ORIGINAL_ENV;
    });

    it('throws when MPESA_ENVIRONMENT is unset and no override given', () => {
      expect(() => new MpesaStkPush({})).toThrow(/MPESA_ENVIRONMENT/);
    });

    it('reads MPESA_ENVIRONMENT from process.env', () => {
      process.env.MPESA_ENVIRONMENT = 'production';
      const fromEnv = new MpesaStkPush({});
      expect((fromEnv as any).config.environment).toBe('production');
    });

    it('accepts explicit override regardless of env', () => {
      const override = new MpesaStkPush({ environment: 'sandbox' });
      expect((override as any).config.environment).toBe('sandbox');
    });
  });
});
