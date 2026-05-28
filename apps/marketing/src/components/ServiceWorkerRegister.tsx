'use client';

/**
 * ServiceWorkerRegister — registers `/sw.js` after hydration.
 *
 * Lazy, idempotent, and silent. Skipped in dev so the SW does not
 * cache HMR chunks. Failures are swallowed because a missing SW must
 * not break the marketing site.
 */

import { useEffect } from 'react';

export function ServiceWorkerRegister(): null {
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    if (!('serviceWorker' in navigator)) return undefined;
    if (process.env.NODE_ENV === 'development') return undefined;

    const register = async (): Promise<void> => {
      try {
        await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      } catch {
        // Silent.
      }
    };

    const ric = (
      window as unknown as {
        readonly requestIdleCallback?: (cb: () => void) => void;
      }
    ).requestIdleCallback;
    if (typeof ric === 'function') {
      ric(() => {
        void register();
      });
      return undefined;
    }
    const t = window.setTimeout(() => {
      void register();
    }, 1500);
    return () => window.clearTimeout(t);
  }, []);
  return null;
}
