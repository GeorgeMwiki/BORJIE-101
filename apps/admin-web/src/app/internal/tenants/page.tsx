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
          className="rounded-md bg-signal-500 px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-signal-500/90"
        >
          New tenant
        </button>
      }
    >
      <TenantDirectory />
    </ScreenShell>
  );
}
