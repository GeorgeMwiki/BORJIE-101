import type { Metadata } from 'next';
import Link from 'next/link';
import { Nav } from '@/components/Nav';
import { Footer } from '@/components/Footer';
import { getLocale } from '@/lib/locale';

export const metadata: Metadata = {
  title: 'Documentation — Borjie API & integration',
  description:
    'Borjie developer documentation. OpenAPI spec, authentication, Master Brain SSE protocol, marketplace bids, compliance webhooks. Hosted Swagger UI on GitHub Pages.',
};

interface DocLink {
  readonly title: string;
  readonly summary: string;
  readonly href: string;
  readonly external?: boolean;
}

const SECTIONS: ReadonlyArray<{
  title: string;
  links: ReadonlyArray<DocLink>;
}> = [
  {
    title: 'Reference',
    links: [
      {
        title: 'OpenAPI 3.1 specification (Swagger UI)',
        summary:
          'Every endpoint in the Borjie API gateway — auth, mining, marketplace, compliance, public chat. Try-it-out enabled.',
        href: 'https://georgemwiki.github.io/BORJIE-101/',
        external: true,
      },
      {
        title: 'GitHub repository',
        summary:
          'Borjie monorepo: packages, services, apps, migrations, and CI workflows. MIT-licensed where possible.',
        href: 'https://github.com/GeorgeMwiki/BORJIE-101',
        external: true,
      },
    ],
  },
  {
    title: 'Protocols',
    links: [
      {
        title: 'Master Brain chat — Server-Sent Events',
        summary:
          'POST /api/v1/mining/chat streams turn.accepted → message_chunk* → done | error. Same shape as the public marketing widget.',
        href: 'https://github.com/GeorgeMwiki/BORJIE-101/blob/main/docs/CHAT_PROTOCOL.md',
        external: true,
      },
      {
        title: 'Generative UI (AG-UI) primitives',
        summary:
          'Typed UiPart payloads emitted by the kernel render-block tools: charts, tables, timelines, maps, calendars, forms, approvals, evidence cards.',
        href: 'https://github.com/GeorgeMwiki/BORJIE-101/blob/main/packages/genui/README.md',
        external: true,
      },
    ],
  },
  {
    title: 'Operations',
    links: [
      {
        title: 'Status page',
        summary:
          'Live status of api-gateway, owner portal, admin portal, Supabase Postgres, and Anthropic upstream.',
        href: 'https://status.borjie.co.tz',
        external: true,
      },
      {
        title: 'Privacy & DPA',
        summary:
          'Tanzania PDPA-aligned privacy policy and Borjie Data Processing Agreement for buyers.',
        href: '/privacy',
      },
    ],
  },
];

export default async function DocsPage() {
  const locale = await getLocale();

  return (
    <>
      <Nav locale={locale} />
      <main id="main-content" className="mx-auto max-w-3xl px-6 pb-24 pt-20 lg:px-8">
        <p className="font-mono text-xs uppercase tracking-widest text-signal-500">
          Documentation
        </p>
        <h1 className="mt-4 font-display text-4xl font-medium tracking-tight text-balance sm:text-5xl">
          Build on Borjie.
        </h1>
        <p className="mt-6 text-lg leading-relaxed text-neutral-300">
          Borjie exposes a typed REST + SSE API for everything Mr. Mwikila
          and the 27 junior agents can do. Use these references to
          integrate Borjie with your buyer ERP, regulator pipeline, or
          custom workflow.
        </p>

        <div className="mt-12 space-y-12">
          {SECTIONS.map((section) => (
            <section key={section.title}>
              <h2 className="font-display text-2xl font-semibold">
                {section.title}
              </h2>
              <ul className="mt-6 space-y-4">
                {section.links.map((link) => (
                  <li key={link.title}>
                    {link.external ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noreferrer"
                        className="block rounded-lg border border-border bg-surface/40 p-5 transition-colors hover:bg-surface"
                      >
                        <h3 className="font-display text-base font-semibold">
                          {link.title}{' '}
                          <span aria-hidden="true" className="text-neutral-500">
                            ↗
                          </span>
                        </h3>
                        <p className="mt-2 text-sm leading-relaxed text-neutral-400">
                          {link.summary}
                        </p>
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="block rounded-lg border border-border bg-surface/40 p-5 transition-colors hover:bg-surface"
                      >
                        <h3 className="font-display text-base font-semibold">
                          {link.title}
                        </h3>
                        <p className="mt-2 text-sm leading-relaxed text-neutral-400">
                          {link.summary}
                        </p>
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className="mt-16 rounded-lg border border-accent/40 bg-surface/30 p-6 text-center">
          <p className="text-sm text-foreground/70">
            Questions on integration?{' '}
            <a
              href="mailto:developers@borjie.co.tz"
              className="font-semibold text-signal-500 hover:text-signal-400"
            >
              developers@borjie.co.tz
            </a>
          </p>
        </div>
      </main>
      <Footer locale={locale} />
    </>
  );
}
