import { StubBadge } from './StubBadge';

interface DataSourceBadgeProps {
  readonly source: 'live' | 'mock';
}

/**
 * Tiny status pill that tells the operator whether the rows they're
 * looking at came from the gateway ('live') or from the in-memory
 * fixtures ('mock'). Keeps demos honest before the backend is online.
 */
export function DataSourceBadge({ source }: DataSourceBadgeProps): JSX.Element {
  return source === 'live' ? (
    <StubBadge tone="success">Live</StubBadge>
  ) : (
    <StubBadge tone="info">Mock data</StubBadge>
  );
}
