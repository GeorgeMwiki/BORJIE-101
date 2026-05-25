/**
 * /jarvis — Nyumba Mind for the Borjie HQ operator.
 *
 * Every internal admin gets their own first-person AI counterpart
 * sitting on top of the central-intelligence brain kernel. This page
 * is the operator's daily chat surface — sends thoughts to
 * /api/v1/platform/jarvis/think and renders the typed decision
 * (citations, confidence, persona greeting).
 */

import { JarvisConsole } from './JarvisConsole';

export const metadata = {
  title: 'Nyumba Mind · Borjie HQ',
};

/**
 * Skip static prerender — JarvisConsole and its chat-ui / genui
 * descendants touch `window` (Web Speech adapter, uiParts streaming
 * hook, dynamic-renderer mounts). Static export crashes with
 * `ReferenceError: window is not defined`. Force dynamic rendering
 * so the page is built at request time.
 */
export const dynamic = 'force-dynamic';

export default function JarvisPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border bg-surface px-6 py-4">
        <h1 className="text-xl font-semibold text-foreground">Nyumba Mind</h1>
        <p className="text-sm text-muted-foreground">
          Your personal AI counterpart for the Borjie platform.
        </p>
      </header>
      <main className="flex flex-1 justify-center px-6 py-6">
        <div className="w-full max-w-3xl">
          <JarvisConsole />
        </div>
      </main>
    </div>
  );
}
