import { ScreenShell } from '@/components/internal/ScreenShell';
import { findScreen } from '@/lib/internal/screens';
import { TenantDetail } from '@/components/internal/tenants/TenantDetail';
import { readLocaleFromServerCookies } from '@/lib/locale.server';

const SCREEN = findScreen('tenants/detail')!;

// Next.js 15 — dynamic route params are async, must be awaited.
interface PageProps {
  readonly params: Promise<{ readonly id: string }>;
}

export default async function TenantDetailPage({ params }: PageProps): Promise<JSX.Element> {
  const { id } = await params;
  const locale = await readLocaleFromServerCookies();
  return (
    <ScreenShell screen={SCREEN}>
      <TenantDetail tenantId={id} initialLocale={locale} />
    </ScreenShell>
  );
}
