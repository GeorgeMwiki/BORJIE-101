"use client";

/**
 * ConversationalOnboardingFlow.
 *
 * Replaces the static signup form with a guided conversation. UI only -
 * the actual extraction is delegated to the existing field-extractor in
 * `src/core/conversational-agent/extractors/field-extractor.ts` (called
 * from a server route or background task; this component takes the
 * extracted value via prop or callback).
 *
 * This is purely additive: it does not modify any existing onboarding
 * flow logic. Mount it in a NEW route or behind a feature flag.
 */

import { useCallback, useMemo, useState } from "react";
import {
  ONBOARDING_FIELDS,
  buildConfirmationBanner,
  initialState,
  isReadyToConfirm,
  selectRegister,
  updateField,
  type OnboardingFieldId,
  type OnboardingState,
} from "./conversational-onboarding-state";

interface ConversationalOnboardingFlowProps {
  /**
   * Called when the visitor types a free-form message. The host wires
   * this to the field-extractor and then calls `applyExtracted` with
   * the structured result.
   */
  readonly onMessage: (message: string) => void;
  /** Called when the visitor confirms the account creation. */
  readonly onConfirm: (state: OnboardingState) => void;
  /** Called if the visitor opts out (no account created, no record kept). */
  readonly onAbort?: () => void;
  /** Visitor language preference. */
  readonly initialLanguage?: "en" | "sw";
}

export function ConversationalOnboardingFlow({
  onMessage,
  onConfirm,
  onAbort,
  initialLanguage = "en",
}: ConversationalOnboardingFlowProps) {
  const [state, setState] = useState<OnboardingState>(() => {
    const init = initialState();
    if (initialLanguage) {
      return updateField({
        state: init,
        fieldId: "language",
        value: initialLanguage,
        fromMessage: "[initial]",
        confidence: "high",
      });
    }
    return init;
  });
  const [draft, setDraft] = useState("");

  const currentField = useMemo(() => {
    if (state.currentStep === "confirm" || state.currentStep === "done") {
      return null;
    }
    return ONBOARDING_FIELDS.find((f) => f.id === state.currentStep) ?? null;
  }, [state]);

  const register = selectRegister(state.affect);

  const applyExtracted = useCallback(
    (fieldId: OnboardingFieldId, value: string, fromMessage: string) => {
      setState((s) =>
        updateField({
          state: s,
          fieldId,
          value,
          fromMessage,
          confidence: "high",
        }),
      );
    },
    [],
  );

  const handleSubmitMessage = useCallback(() => {
    const message = draft.trim();
    if (!message) return;
    onMessage(message);
    if (currentField) {
      // Naive client-side fast path: take the full message as the field
      // value when no async extractor is wired. Real apps replace with
      // applyExtracted from the server response.
      applyExtracted(currentField.id, message, message);
    }
    setDraft("");
  }, [draft, currentField, onMessage, applyExtracted]);

  if (state.currentStep === "confirm") {
    const banner = buildConfirmationBanner(state);
    return (
      <ConfirmationView
        banner={banner}
        onConfirm={() => {
          setState((s) => ({ ...s, currentStep: "done" }));
          onConfirm(state);
        }}
        onEdit={() =>
          setState((s) => ({
            ...s,
            currentStep: "displayName",
          }))
        }
        onAbort={onAbort}
      />
    );
  }

  if (state.currentStep === "done") {
    return (
      <div
        role="status"
        className="rounded-xl border border-emerald-300 bg-emerald-50 p-5 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
      >
        Account created. Welcome to Borjie.
      </div>
    );
  }

  return (
    <section
      aria-label="Conversational onboarding"
      className="mx-auto max-w-xl rounded-xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900"
      data-testid="conversational-onboarding"
      data-current-step={state.currentStep}
      data-register={register}
    >
      {currentField ? (
        <>
          <header className="mb-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-amber-800 dark:text-amber-300">
              Step
            </p>
            <h2 className="mt-1 text-lg font-semibold text-stone-900 dark:text-stone-100">
              {currentField.label}
            </h2>
          </header>
          <p className="mb-3 text-sm text-stone-800 dark:text-stone-200">
            {currentField.aiAsk}
          </p>
          <details className="mb-4 text-xs text-stone-500 dark:text-stone-400">
            <summary className="cursor-pointer font-medium">
              Why I am asking
            </summary>
            <p className="mt-1">{currentField.whyNeeded}</p>
          </details>
          <div className="flex gap-2">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Type your reply"
              className="flex-1 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmitMessage();
              }}
              data-testid="onboarding-input"
            />
            <button
              type="button"
              onClick={handleSubmitMessage}
              disabled={!draft.trim()}
              className="rounded-md bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </>
      ) : null}
      {onAbort ? (
        <button
          type="button"
          onClick={onAbort}
          className="mt-4 text-xs text-stone-500 underline-offset-2 hover:underline"
          aria-label="Exit without creating an account"
        >
          Exit without saving
        </button>
      ) : null}
      {isReadyToConfirm(state) ? (
        <p className="mt-3 text-xs text-stone-500">
          You can confirm now, or keep going to refine your answers.
        </p>
      ) : null}
    </section>
  );
}

function ConfirmationView({
  banner,
  onConfirm,
  onEdit,
  onAbort,
}: {
  readonly banner: ReturnType<typeof buildConfirmationBanner>;
  readonly onConfirm: () => void;
  readonly onEdit: () => void;
  readonly onAbort?: () => void;
}) {
  return (
    <section
      aria-label="Confirmation"
      className="mx-auto max-w-xl rounded-xl border border-amber-700/30 bg-amber-50 p-6 dark:border-amber-700/60 dark:bg-amber-950"
      data-testid="onboarding-confirmation"
    >
      <h2 className="text-lg font-semibold text-amber-900 dark:text-amber-200">
        {banner.summary}
      </h2>
      <ul className="mt-4 space-y-3">
        {banner.rows.map((row) => (
          <li
            key={row.label}
            className="rounded-md border border-amber-700/20 bg-white p-3 dark:border-amber-700/40 dark:bg-stone-900"
            data-testid="confirmation-row"
          >
            <p className="text-xs font-semibold uppercase tracking-wider text-stone-500">
              {row.label}
            </p>
            <p className="mt-1 text-sm text-stone-900 dark:text-stone-100">
              {row.value}
            </p>
            <p className="mt-1 text-xs italic text-stone-500">
              {row.provenanceText}
            </p>
          </li>
        ))}
      </ul>
      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onConfirm}
          className="rounded-md bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-800"
          data-testid="onboarding-confirm-cta"
        >
          {banner.ctaPrimary}
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="rounded-md border border-stone-300 bg-white px-4 py-2 text-sm text-stone-700 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300"
        >
          {banner.ctaSecondary}
        </button>
        {onAbort ? (
          <button
            type="button"
            onClick={onAbort}
            className="ml-auto text-xs text-stone-500 underline-offset-2 hover:underline"
          >
            Exit without saving
          </button>
        ) : null}
      </div>
    </section>
  );
}
