'use client';

import { useMemo, useState, type ReactElement } from 'react';
import { Button } from '@borjie/design-system';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { StatusPill } from '@/components/shared/StatusPill';
import {
  useAdvisorStartingPoints,
  useAskAdvisor,
  useAdvisorFeedback,
  type AdvisorEvidence,
} from '@/lib/queries/role-advisor';
import { roleAdvisorPanelStrings as STR } from '@/i18n/strings/role-advisor-panel';

/**
 * RoleAdvisorPanel — the owner cockpit surface for the universal
 * role-aware advisor (`@borjie/role-aware-advisor`, exposed at
 * `/api/v1/ask`).
 *
 * The owner asks a free-text question; the advisor routes it (sub-advisor
 * vs brain-direct), fetches scoped evidence through its data-access
 * guard, redacts PII, and synthesises a role-tailored answer. This panel
 * renders:
 *   - role-tuned starting-point chips (one tap submits the prompt)
 *   - the answer + its evidence chain (evidence-required AI output)
 *   - the guard's posture: how many fields were redacted / snippets denied
 *   - a thumbs-up / thumbs-down feedback control (feeds the lesson store)
 *
 * Bilingual: strings are inlined per-locale and rendered strictly for the
 * active language (no EN/SW mixing, per CLAUDE.md). This component is
 * self-contained — mount it from the cockpit shell (see integration
 * report for the nav step).
 */

type Locale = 'sw' | 'en';

function pick(entry: { en: string; sw: string }, locale: Locale): string {
  return locale === 'sw' ? entry.sw : entry.en;
}

export interface RoleAdvisorPanelProps {
  readonly locale?: Locale;
  /** Stable session id so feedback + starting points correlate. */
  readonly sessionId?: string;
}

export function RoleAdvisorPanel({
  locale = 'en',
  sessionId = 'owner-cockpit',
}: RoleAdvisorPanelProps): ReactElement {
  const [question, setQuestion] = useState('');
  const starters = useAdvisorStartingPoints(sessionId);
  const ask = useAskAdvisor();
  const feedback = useAdvisorFeedback();

  const answer = ask.data ?? null;
  const evidence: ReadonlyArray<AdvisorEvidence> = useMemo(
    () => answer?.evidence ?? [],
    [answer],
  );

  const submit = (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < 2 || ask.isPending) return;
    feedback.reset();
    ask.mutate({ question: trimmed, sessionId });
  };

  return (
    <section
      className="flex flex-col gap-5 px-2 py-2"
      data-testid="owner-os-panel-role-advisor"
    >
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-foreground">
          {pick(STR.title, locale)}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {pick(STR.subtitle, locale)}
        </p>
      </div>

      {/* Ask box */}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit(question);
        }}
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={pick(STR.placeholder, locale)}
          className="flex-1 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
          data-testid="role-advisor-input"
        />
        <Button
          type="submit"
          disabled={question.trim().length < 2 || ask.isPending}
          data-testid="role-advisor-send"
        >
          {ask.isPending ? pick(STR.thinking, locale) : pick(STR.send, locale)}
        </Button>
      </form>

      {/* Starting points */}
      {!answer && (starters.data?.length ?? 0) > 0 ? (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {pick(STR.startersTitle, locale)}
          </p>
          <div className="flex flex-wrap gap-2">
            {starters.data!.map((chip) => (
              <button
                key={chip.id}
                onClick={() => {
                  setQuestion(chip.prompt);
                  submit(chip.prompt);
                }}
                className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-foreground hover:border-primary"
                title={chip.reason}
                data-testid={`role-advisor-chip-${chip.id}`}
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Error */}
      {ask.isError ? (
        <Card variant="outline">
          <CardContent className="pt-6">
            <p className="text-sm text-danger">{pick(STR.error, locale)}</p>
          </CardContent>
        </Card>
      ) : null}

      {/* Answer */}
      {answer ? (
        <Card>
          <CardHeader bordered>
            <CardTitle size="sm">{pick(STR.answerTitle, locale)}</CardTitle>
            <div className="flex flex-wrap gap-2 pt-1">
              {answer.redactedFields.length > 0 ? (
                <StatusPill
                  tone="amber"
                  label={`${answer.redactedFields.length} ${pick(STR.redacted, locale)}`}
                />
              ) : null}
              {answer.deniedSnippetIds.length > 0 ? (
                <StatusPill
                  tone="red"
                  label={`${answer.deniedSnippetIds.length} ${pick(STR.denied, locale)}`}
                />
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
              {answer.answer}
            </p>

            {/* Evidence chain */}
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {pick(STR.evidenceTitle, locale)}
              </p>
              {evidence.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {pick(STR.noEvidence, locale)}
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {evidence.map((e) => (
                    <li
                      key={e.id}
                      className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-foreground"
                    >
                      <span className="font-medium text-muted-foreground">
                        {e.resource}
                      </span>
                      {' · '}
                      {e.summary}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Feedback */}
            {feedback.isSuccess ? (
              <p className="text-xs text-success">{pick(STR.thanks, locale)}</p>
            ) : (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    feedback.mutate({
                      sessionId,
                      answerId: answer.answerId,
                      rating: 5,
                    })
                  }
                  disabled={feedback.isPending}
                  className="hover:border-success"
                  data-testid="role-advisor-feedback-up"
                >
                  {pick(STR.helpful, locale)}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    feedback.mutate({
                      sessionId,
                      answerId: answer.answerId,
                      rating: 1,
                    })
                  }
                  disabled={feedback.isPending}
                  className="hover:border-danger"
                  data-testid="role-advisor-feedback-down"
                >
                  {pick(STR.notHelpful, locale)}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}
