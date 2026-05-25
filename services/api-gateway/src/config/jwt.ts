import crypto from 'crypto';
import { logger } from '../utils/logger.js';

// Dev-only ephemeral secret. Generated per-process so it never ships in
// source, never persists across restarts, and never matches a known value
// that an attacker could guess. Production MUST set JWT_SECRET explicitly.
let ephemeralDevSecret: string | null = null;

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();

  if (secret) {
    if (secret.length < 32) {
      throw new Error(
        'JWT_SECRET must be at least 32 characters (use: openssl rand -base64 48)'
      );
    }
    return secret;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Missing required: JWT_SECRET');
  }

  if (!ephemeralDevSecret) {
    ephemeralDevSecret = crypto.randomBytes(48).toString('base64');
    logger.warn('[jwt] JWT_SECRET not set — generated ephemeral dev secret. ' +
        'Tokens will not survive process restart. Set JWT_SECRET in .env for persistent dev tokens.');
  }
  return ephemeralDevSecret;
}
