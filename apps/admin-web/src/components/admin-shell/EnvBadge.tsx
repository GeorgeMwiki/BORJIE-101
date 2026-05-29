/**
 * EnvBadge — color-coded environment pill for the admin top bar.
 *
 * Reads `NEXT_PUBLIC_BORJIE_ENV` (falls back to NODE_ENV mapping).
 *   - prod          -> red    (high alert)
 *   - staging       -> amber  (caution)
 *   - dev / local   -> neutral slate
 *
 * Mirrors LitFin's admin top-bar env badge pattern — at-a-glance
 * confirmation of which database the operator is staring at.
 */

type EnvTone = 'prod' | 'staging' | 'dev';

interface EnvBadgeProps {
  /** Override for tests. Otherwise resolved from env. */
  readonly env?: string;
}

function resolveEnv(raw: string | undefined): EnvTone {
  const value = (raw ?? '').toLowerCase();
  if (value === 'prod' || value === 'production') return 'prod';
  if (value === 'staging' || value === 'stage') return 'staging';
  return 'dev';
}

const TONE_STYLES: Record<EnvTone, string> = {
  prod: 'border-danger/50 bg-danger/15 text-danger',
  staging: 'border-warning/50 bg-warning/15 text-warning',
  dev: 'border-border bg-surface-sunken text-neutral-400',
};

const TONE_LABELS: Record<EnvTone, string> = {
  prod: 'PROD',
  staging: 'STAGING',
  dev: 'DEV',
};

export function EnvBadge({ env }: EnvBadgeProps = {}): JSX.Element {
  const resolvedRaw = env ?? process.env.NEXT_PUBLIC_BORJIE_ENV ?? process.env.NODE_ENV;
  const tone = resolveEnv(resolvedRaw);
  return (
    <span
      role="status"
      aria-label={`Environment ${TONE_LABELS[tone]}`}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-tiny font-mono font-semibold tracking-widest ${TONE_STYLES[tone]}`}
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${
          tone === 'prod'
            ? 'bg-danger animate-pulse'
            : tone === 'staging'
              ? 'bg-warning'
              : 'bg-neutral-500'
        }`}
      />
      {TONE_LABELS[tone]}
    </span>
  );
}
