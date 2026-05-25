/**
 * Logger utility for Document Intelligence Service
 */

import winston from 'winston';

const { combine, timestamp, printf, colorize, errors } = winston.format;

const logFormat = printf(({ level, message, timestamp: ts, stack, ...metadata }) => {
  let log = `${ts} [${level}]: ${message}`;
  if (Object.keys(metadata).length > 0) {
    log += ` ${JSON.stringify(metadata)}`;
  }
  if (stack) {
    log += `\n${stack}`;
  }
  return log;
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    logFormat
  ),
  defaultMeta: { service: 'document-intelligence' },
  transports: [
    new winston.transports.Console({
      format: combine(
        colorize(),
        logFormat
      ),
    }),
  ],
});

// Add file transport in production
if (process.env.NODE_ENV === 'production') {
  logger.add(
    new winston.transports.File({
      filename: 'logs/document-intelligence-error.log',
      level: 'error',
    })
  );
  logger.add(
    new winston.transports.File({
      filename: 'logs/document-intelligence-combined.log',
    })
  );
}

export function createChildLogger(context: Record<string, unknown>) {
  return logger.child(context);
}
