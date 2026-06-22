/**
 * StatusPill (CONVERGED onto the DS `Badge`).
 *
 * Thin wrapper that maps owner-web's colour-tone vocabulary
 * (green / amber / red / neutral) onto the canonical DS `Badge` soft
 * variants, so every status chip inherits the shared radius, padding,
 * and semantic token from ONE source — no more app-local `.pill` CSS.
 *
 * Public API ({ tone, label }) is UNCHANGED — do not alter the call
 * signature; existing importers pass `tone` + `label` verbatim.
 */
import { Badge, type BadgeProps } from '@borjie/design-system';

interface StatusPillProps {
  readonly tone: 'green' | 'amber' | 'red' | 'neutral';
  readonly label: string;
}

const TONE_VARIANT: Record<StatusPillProps['tone'], BadgeProps['variant']> = {
  green: 'success-soft',
  amber: 'warning-soft',
  red: 'error-soft',
  neutral: 'secondary',
};

export function StatusPill({ tone, label }: StatusPillProps) {
  return <Badge variant={TONE_VARIANT[tone]}>{label}</Badge>;
}
