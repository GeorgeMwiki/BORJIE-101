import { StubBadge } from '../StubBadge';
import type { TenantStatus } from '@/lib/mocks/types';

const TONE: Record<TenantStatus, 'success' | 'warn' | 'danger' | 'neutral' | 'info'> = {
  Active: 'success',
  Trial: 'info',
  'Past due': 'warn',
  Suspended: 'danger',
};

export function TenantStatusBadge({ status }: { readonly status: TenantStatus }): JSX.Element {
  return <StubBadge tone={TONE[status]}>{status}</StubBadge>;
}
