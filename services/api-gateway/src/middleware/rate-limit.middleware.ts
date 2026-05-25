/**
 * Simple in-memory rate limiter middleware for Express.
 * For production with multiple instances, replace with Redis-backed limiter.
 */

import type { Request, Response, NextFunction } from 'express';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

const CLEANUP_INTERVAL = 60_000;
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.resetAt) store.delete(key);
  }
}, CLEANUP_INTERVAL).unref();

export interface RateLimitOptions {
  windowMs?: number;
  maxRequests?: number;
  keyGenerator?: (req: Request) => string;
}

export function rateLimitMiddleware(options: RateLimitOptions = {}) {
  const windowMs = options.windowMs ?? parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);
  const maxRequests = options.maxRequests ?? parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10);
  const keyGenerator = options.keyGenerator ?? ((req: Request) => {
    return req.ip || req.headers['x-forwarded-for']?.toString() || 'unknown';
  });

  return (req: Request, res: Response, next: NextFunction) => {
    const key = keyGenerator(req);
    const now = Date.now();
    let entry = store.get(key);

    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }

    entry.count++;

    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - entry.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000));

    if (entry.count > maxRequests) {
      return res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests. Please try again later.',
          retryAfter: Math.ceil((entry.resetAt - now) / 1000),
        },
      });
    }

    next();
  };
}
