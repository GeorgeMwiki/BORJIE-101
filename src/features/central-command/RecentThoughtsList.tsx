/**
 * RecentThoughtsList, last 20 high-salience outbox entries.
 *
 * The outbox is the brain's narration channel. We surface entries with
 * salience > 0.5 so the operator can scan what's worth attention.
 */

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { RecentThought } from "./types";

interface RecentThoughtsListProps {
  readonly thoughts: ReadonlyArray<RecentThought>;
}

export function RecentThoughtsList({ thoughts }: RecentThoughtsListProps) {
  return (
    <Card variant="elevated" aria-labelledby="recent-thoughts-title">
      <CardHeader>
        <CardTitle id="recent-thoughts-title">Recent thoughts</CardTitle>
        <CardDescription>
          Last 20 outbox entries with salience &gt; 0.5.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {thoughts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No recent high-salience thoughts.
          </p>
        ) : (
          <ol className="space-y-2" aria-label="Recent brain thoughts">
            {thoughts.map((t) => (
              <li
                key={t.id}
                className="rounded-md border p-3 text-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium">{t.summary}</p>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    s={t.salience.toFixed(2)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t.module} · {new Date(t.emittedAt).toLocaleString()}
                </p>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
