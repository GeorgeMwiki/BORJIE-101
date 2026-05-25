interface StatusPillProps {
  readonly tone: 'green' | 'amber' | 'red' | 'neutral';
  readonly label: string;
}

const TONE_CLASS: Record<StatusPillProps['tone'], string> = {
  green: 'pill-green',
  amber: 'pill-amber',
  red: 'pill-red',
  neutral: '',
};

export function StatusPill({ tone, label }: StatusPillProps) {
  return <span className={`pill ${TONE_CLASS[tone]}`}>{label}</span>;
}
