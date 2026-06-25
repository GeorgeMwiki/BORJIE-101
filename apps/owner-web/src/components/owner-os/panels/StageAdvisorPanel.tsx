'use client';

import { type ReactElement } from 'react';
import { Button } from '@borjie/design-system';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { StatusPill } from '@/components/shared/StatusPill';
import {
  useStageCurrent,
  useStagePlaybook,
  useStageNudges,
  useDismissStageNudge,
  type StageNudge,
} from '@/lib/queries/stage-advisor';
import { stageAdvisorPanelStrings as STR } from '@/i18n/strings/stage-advisor-panel';
import { enumLabel } from './enum-label';

/**
 * StageAdvisorPanel — the owner cockpit surface for the stage-aware
 * capability advisor (`@borjie/stage-advisor`, exposed at
 * `/api/v1/stage`).
 *
 * The advisor classifies the org's lifecycle stage (pre-launch →
 * ecosystem) off real metrics with hysteresis, then surfaces:
 *   - the current stage + confidence + the evidence behind it
 *   - the active onboarding playbook (completion ratio + next tasks)
 *   - proactive nudges the org should act on now (dismissable)
 *
 * Graceful degradation: the gateway route is mounted but the stage
 * service may not yet be bound into the request registry, returning 503.
 * Each section renders an "unavailable" state in that case rather than a
 * hard error. Bilingual, single-language per active locale.
 */

type Locale = 'sw' | 'en';

function pick(entry: { en: string; sw: string }, locale: Locale): string {
  return locale === 'sw' ? entry.sw : entry.en;
}

function urgencyTone(
  urgency: StageNudge['urgency'],
): 'green' | 'amber' | 'red' | 'neutral' {
  if (urgency === 'critical' || urgency === 'high') return 'red';
  if (urgency === 'medium') return 'amber';
  if (urgency === 'low') return 'neutral';
  return 'green';
}

export interface StageAdvisorPanelProps {
  readonly locale?: Locale;
}

export function StageAdvisorPanel({
  locale = 'en',
}: StageAdvisorPanelProps): ReactElement {
  const current = useStageCurrent();
  const playbook = useStagePlaybook();
  const nudges = useStageNudges();
  const dismiss = useDismissStageNudge();

  // A 503 throws an ApiError with status 503 — react-query exposes it on
  // `.error`. We treat any error on `current` as the unavailable signal.
  const unavailable = current.isError;
  const stage = current.data;

  return (
    <section
      className="flex flex-col gap-5 px-2 py-2"
      data-testid="owner-os-panel-stage-advisor"
    >
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-foreground">
          {pick(STR.title, locale)}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {pick(STR.subtitle, locale)}
        </p>
      </div>

      {unavailable ? (
        <Card variant="outline">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              {pick(STR.unavailable, locale)}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* Current stage */}
      {!unavailable ? (
        <Card>
          <CardHeader bordered>
            <div className="flex items-center justify-between gap-3">
              <CardTitle size="sm">
                {current.isLoading
                  ? pick(STR.loading, locale)
                  : stage?.stage
                    ? stage.stage
                    : pick(STR.noStage, locale)}
              </CardTitle>
              {stage?.stage ? (
                <StatusPill
                  tone="green"
                  label={`${Math.round((stage.confidence ?? 0) * 100)}% ${pick(STR.confidence, locale)}`}
                />
              ) : null}
            </div>
          </CardHeader>
          {stage?.stage ? (
            <CardContent className="space-y-4 pt-4">
              {stage.focusAreas.length > 0 ? (
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {pick(STR.focusTitle, locale)}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {stage.focusAreas.map((f) => (
                      <span
                        key={f}
                        className="rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-foreground"
                      >
                        {f}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {stage.evidence.length > 0 ? (
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {pick(STR.evidenceTitle, locale)}
                  </p>
                  <ul className="space-y-1.5">
                    {stage.evidence.map((e, i) => (
                      <li
                        key={i}
                        className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-foreground"
                      >
                        {e}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </CardContent>
          ) : null}
        </Card>
      ) : null}

      {/* Playbook */}
      {!unavailable && playbook.data?.evaluation ? (
        <Card>
          <CardHeader bordered>
            <div className="flex items-center justify-between gap-3">
              <CardTitle size="sm">{pick(STR.playbookTitle, locale)}</CardTitle>
              <StatusPill
                tone={
                  playbook.data.evaluation.completionRatio >= 1
                    ? 'green'
                    : 'amber'
                }
                label={`${playbook.data.evaluation.completedTasks}/${playbook.data.evaluation.totalTasks} ${pick(STR.tasksDone, locale)}`}
              />
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            {playbook.data.evaluation.nextIncompleteTasks.length > 0 ? (
              <>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {pick(STR.nextTitle, locale)}
                </p>
                <ul className="space-y-2">
                  {playbook.data.evaluation.nextIncompleteTasks.map((task) => (
                    <li
                      key={task.taskId}
                      className="rounded-md border border-border bg-card px-3 py-2"
                    >
                      <p className="text-sm font-medium text-foreground">
                        {task.taskName}
                      </p>
                      {task.description ? (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {task.description}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* Nudges */}
      {!unavailable ? (
        <Card>
          <CardHeader bordered>
            <CardTitle size="sm">{pick(STR.nudgesTitle, locale)}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-4">
            {nudges.isLoading ? (
              <p className="text-sm text-muted-foreground">
                {pick(STR.loading, locale)}
              </p>
            ) : (nudges.data?.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">
                {pick(STR.noNudges, locale)}
              </p>
            ) : (
              nudges.data!.map((nudge) => (
                <div
                  key={nudge.id}
                  className="rounded-md border border-border bg-card p-3"
                  data-testid={`stage-nudge-${nudge.id}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <StatusPill
                          tone={urgencyTone(nudge.urgency)}
                          label={enumLabel('alertSeverity', nudge.urgency, locale)}
                        />
                        <p className="text-sm font-medium text-foreground">
                          {nudge.title}
                        </p>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {nudge.message}
                      </p>
                    </div>
                    {nudge.dismissable ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => dismiss.mutate(nudge.id)}
                        loading={dismiss.isPending}
                        className="shrink-0 text-muted-foreground hover:border-danger"
                        data-testid={`stage-nudge-dismiss-${nudge.id}`}
                      >
                        {pick(STR.dismiss, locale)}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}
