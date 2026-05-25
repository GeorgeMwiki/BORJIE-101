import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ConsoleTopNav } from '@/components/internal/ConsoleTopNav';

export const metadata: Metadata = {
  title: 'Borjie Console — Internal Admin',
  description:
    'Borjie internal admin console — 20 operational surfaces covering tenants, intelligence corpus, quality, and platform ops.',
};

export default function InternalLayout({ children }: { readonly children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <ConsoleTopNav />
      <div className="flex-1">{children}</div>
    </div>
  );
}
