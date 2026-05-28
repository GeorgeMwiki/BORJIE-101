import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { QueryProvider } from '@/components/internal/QueryProvider';

export const metadata: Metadata = {
  title: 'Borjie Console — Internal Admin',
  description:
    'Borjie internal admin console — 20 operational surfaces covering tenants, intelligence corpus, quality, and platform ops.',
};

/**
 * Internal-admin route group layout.
 *
 * The legacy `<ConsoleTopNav />` was removed when the LitFin-parity
 * `AdminShell` (root layout) took over the top-level chrome. This
 * layout now only injects the react-query provider that every
 * internal screen depends on.
 */
export default function InternalLayout({ children }: { readonly children: ReactNode }) {
  return <QueryProvider>{children}</QueryProvider>;
}
