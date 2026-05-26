import { ScreenShell } from '@/components/internal/ScreenShell';
import { findScreen } from '@/lib/internal/screens';
import { TenantDirectory } from '@/components/internal/tenants/TenantDirectory';

const SCREEN = findScreen('tenants')!;

export default function TenantDirectoryPage(): JSX.Element {
  return (
    <ScreenShell
      screen={SCREEN}
      actions={
        <button
          type="button"
          disabled
          title="Provisioning form lands with self-serve tenant onboarding (SCRUB-4: POST /internal/tenants exists; needs admin-web NewTenantForm)"
          className="rounded-md bg-signal-500/40 px-3 py-1.5 text-xs font-medium text-primary-foreground opacity-50 cursor-not-allowed"
        >
          New tenant
        </button>
      }
    >
      <TenantDirectory />
    </ScreenShell>
  );
}
