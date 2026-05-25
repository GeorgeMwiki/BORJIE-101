/**
 * Structured logger for payment operations
 * Uses pino for production-grade logging with redaction of sensitive data
 */
import pino from 'pino';

const REDACT_FIELDS = [
  'password',
  'secret',
  'token',
  'authorization',
  'phoneNumber',
  'phone',
  'msisdn',
  'consumerKey',
  'consumerSecret',
  'passKey',
  'securityCredential',
];

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: {
    paths: REDACT_FIELDS.map((f) => `*.${f}`),
    censor: '[REDACTED]',
  },
  formatters: {
    level: (label: string) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = typeof logger;
