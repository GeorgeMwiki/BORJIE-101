import type { Metadata } from 'next';
import Link from 'next/link';
import { Nav } from '@/components/Nav';
import { Footer } from '@/components/Footer';
import { getLocale } from '@/lib/locale';

export const metadata: Metadata = {
  title: 'Data Processing Agreement — Borjie',
  description:
    'Borjie Data Processing Agreement (DPA). Tanzania Personal Data Protection Act 2022. Tenant isolation, regional storage, audit-hash chains, sub-processor list.',
};

interface Clause {
  readonly title: string;
  readonly body: string;
}

const CLAUSES: ReadonlyArray<Clause> = [
  {
    title: '1. Roles',
    body:
      'The tenant (mining owner or mineral buyer) is the Data Controller. Borjie Ltd, registered in Tanzania, is the Data Processor. Borjie processes personal data only on documented instructions from the tenant, except where required by Tanzanian law (e.g. lawful intercept warrants).',
  },
  {
    title: '2. Subject matter and duration',
    body:
      'Borjie processes the personal data of the tenant\'s users (mining owners, site staff, buyers, regulators) for the duration of the tenant\'s active subscription, plus a 90-day audit-retention window after cancellation. After that window, personal data is irreversibly purged and the audit-hash chain is sealed.',
  },
  {
    title: '3. Nature and purpose',
    body:
      'Borjie processes identification data (NIDA, TIN, licence numbers, fingerprint templates for contract signing), business data (sites, drill-holes, parcels, prices, FX positions), and operational data (chat transcripts, audit events). Processing purposes: run the platform, enforce tenant isolation, generate compliance returns for Tumemadini, NEMC, and BoT.',
  },
  {
    title: '4. Sub-processors',
    body:
      'Borjie engages the following sub-processors: Supabase (Postgres + Auth, EU-West-2 region), Anthropic (LLM inference, US region — chat content only, no PII identifiers), OpenAI (embeddings, US region — text only), Upstash (Redis cache, EU region), and Resend (transactional email, EU region). The full list is maintained at /docs and updated 30 days before any change.',
  },
  {
    title: '5. Tenant isolation',
    body:
      'Every database query is scoped by tenant_id with row-level security policies. Every storage object is namespaced by tenant_id. Every JWT carries a tenant claim verified server-side. Cross-tenant access is impossible by design, not by policy.',
  },
  {
    title: '6. Storage location',
    body:
      'Primary Postgres and object storage live in EU-West-2. Borjie is provisioning a Dar es Salaam edge region for tenants who require Tanzania-only residency; opt in via the pilot intake form.',
  },
  {
    title: '7. Encryption',
    body:
      'At rest: AES-256 (storage) and ChaCha20-Poly1305 (envelope-encrypted secrets). In transit: TLS 1.3, HSTS preload, certificate pinning on the mobile apps. Fingerprint templates are hashed with Argon2id before storage; raw templates never touch disk.',
  },
  {
    title: '8. Audit chain',
    body:
      'Every regulatory artifact (licence renewal, ore-parcel receipt, compliance return) carries a SHA-256 hash linked to the previous artifact for the same tenant. The chain is exposed read-only via /api/v1/audit and can be independently verified by the regulator.',
  },
  {
    title: '9. Data-subject rights',
    body:
      'Tenants surface data-subject requests (access, rectification, erasure, portability) via the owner portal. Borjie responds within 30 days as required by the Tanzania Personal Data Protection Act 2022. Erasure does not break the audit chain — the chain retains the hash, not the underlying personal data.',
  },
  {
    title: '10. Incident response',
    body:
      'Borjie commits to notifying affected tenants within 24 hours of confirming a personal-data breach. The notification includes the incident timeline, scope, mitigation, and a remediation plan. Regulators are notified per Tanzania PDPA Section 35.',
  },
  {
    title: '11. Term and termination',
    body:
      'This DPA is effective from the date the tenant accepts the Borjie Terms of Service and continues until both parties\' obligations under PDPA and the subscription contract are fully discharged. Either party may terminate for material breach with 30 days\' written notice.',
  },
];

export default async function DpaPage() {
  const locale = await getLocale();

  return (
    <>
      <Nav locale={locale} />
      <main id="main-content" className="mx-auto max-w-3xl px-6 pb-24 pt-20 lg:px-8">
        <p className="font-mono text-xs uppercase tracking-widest text-signal-500">
          Legal
        </p>
        <h1 className="mt-4 font-display text-4xl font-medium tracking-tight text-balance sm:text-5xl">
          Data Processing Agreement
        </h1>
        <p className="mt-2 font-mono text-[0.7rem] uppercase tracking-widest text-neutral-400">
          Last updated · 2026-05
        </p>
        <p className="mt-6 text-sm leading-relaxed text-neutral-300">
          This DPA forms part of the Borjie Terms of Service and governs
          Borjie&apos;s processing of personal data on behalf of tenants
          under the Tanzania Personal Data Protection Act 2022.
        </p>

        <div className="mt-12 space-y-8 text-sm leading-relaxed text-neutral-400">
          {CLAUSES.map((c) => (
            <section key={c.title}>
              <h2 className="font-display text-base font-semibold text-foreground">
                {c.title}
              </h2>
              <p className="mt-2">{c.body}</p>
            </section>
          ))}
        </div>

        <div className="mt-16 rounded-lg border border-accent/40 bg-surface/30 p-6">
          <p className="text-sm text-foreground/70">
            Need a signed counterpart? Email{' '}
            <a
              href="mailto:legal@borjie.co.tz"
              className="font-semibold text-signal-500 hover:text-signal-400"
            >
              legal@borjie.co.tz
            </a>{' '}
            with your tenant name and we&apos;ll return a counter-signed PDF
            within two business days.
          </p>
          <div className="mt-4 flex flex-wrap gap-3 text-sm">
            <Link
              href="/privacy"
              className="text-neutral-400 hover:text-foreground"
            >
              Privacy policy
            </Link>
            <span className="text-neutral-600">·</span>
            <Link href="/terms" className="text-neutral-400 hover:text-foreground">
              Terms of service
            </Link>
          </div>
        </div>
      </main>
      <Footer locale={locale} />
    </>
  );
}
