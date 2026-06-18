import { Button } from '@borjie/design-system';
import { ScreenShell } from '@/components/internal/ScreenShell';
import { findScreen } from '@/lib/internal/screens';
import { TenantDirectory } from '@/components/internal/tenants/TenantDirectory';

const SCREEN = findScreen('tenants')!;

export default function TenantDirectoryPage(): JSX.Element {
  return (
    <ScreenShell
      screen={SCREEN}
      actions={
        <Button
          type="button"
          size="sm"
          disabled
          title="Provisioning form lands with self-serve tenant onboarding (SCRUB-4: POST /internal/tenants exists; needs admin-web NewTenantForm)"
        >
          New tenant
        </Button>
      }
    >
      <TenantDirectory />
    </ScreenShell>
  );
}
