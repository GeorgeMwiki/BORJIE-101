'use client';

interface DormancyCardProps {
  readonly score: number;
  readonly citation: string;
}

export function DormancyCard({ score, citation }: DormancyCardProps) {
  const tone: 'green' | 'amber' | 'red' =
    score <= 30 ? 'green' : score <= 60 ? 'amber' : 'red';
  const ringColor =
    tone === 'green'
      ? 'hsl(var(--success))'
      : tone === 'amber'
        ? 'hsl(var(--warning))'
        : 'hsl(var(--destructive))';
  return (
    <article className="rounded-md border border-border bg-surface px-4 py-4">
      <div className="text-xs uppercase tracking-wide text-neutral-500">
        Dormancy score (Mining Act 2010 §44)
      </div>
      <div className="mt-3 flex items-center gap-4">
        <div
          className="grid h-24 w-24 place-items-center rounded-full font-display text-3xl text-foreground"
          style={{
            background: `conic-gradient(${ringColor} ${score}%, hsl(var(--border)) 0)`,
          }}
        >
          <span className="grid h-20 w-20 place-items-center rounded-full bg-surface">
            {score}
          </span>
        </div>
        <p className="flex-1 text-xs italic text-neutral-300">{citation}</p>
      </div>
    </article>
  );
}
