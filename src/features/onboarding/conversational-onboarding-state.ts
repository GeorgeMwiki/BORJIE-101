/**
 * Conversational Onboarding - state machine.
 *
 * Replaces the static signup form with a guided conversation. The AI
 * asks naturally, the visitor answers naturally, and the state machine
 * collects exactly the fields needed for account creation.
 *
 * Honest framing rules (PDPA Article 13 transparency):
 *   - Every collected field shows WHERE it came from ("we got this from
 *     your last sentence at 14:32") - the `provenance` map.
 *   - Every step explains WHY this field is needed before asking.
 *   - The final confirmation step shows EVERYTHING the system learned
 *     and requires explicit user confirm before account creation.
 *   - The visitor can exit at any time with no record kept.
 *
 * Pure module: no I/O. Hosted in a React component that wires it to the
 * existing `field-extractor` (commit cf71b19f) for the actual extraction.
 */

export type OnboardingFieldId =
  | "displayName"
  | "businessOrPurpose"
  | "regionOrCountry"
  | "language"
  | "consentScope";

export interface OnboardingField {
  readonly id: OnboardingFieldId;
  readonly label: string;
  /** What the AI says when it first asks this field. */
  readonly aiAsk: string;
  /** Why we need this field, in plain language. */
  readonly whyNeeded: string;
  /** Required for account creation, or optional. */
  readonly required: boolean;
}

export interface FieldProvenance {
  readonly fieldId: OnboardingFieldId;
  readonly extractedAt: string;
  readonly fromMessage: string;
  readonly confidence: "high" | "medium" | "low";
}

export interface OnboardingState {
  readonly fields: Readonly<Partial<Record<OnboardingFieldId, string>>>;
  readonly provenance: Readonly<
    Partial<Record<OnboardingFieldId, FieldProvenance>>
  >;
  readonly currentStep: OnboardingFieldId | "confirm" | "done";
  /** Visitor-perceived emotional state, used to bias the AI register. */
  readonly affect?: "neutral" | "anxious" | "curious" | "frustrated";
  /** When true, the visitor opted out and the session is being torn down. */
  readonly aborted?: boolean;
}

export const ONBOARDING_FIELDS: readonly OnboardingField[] = [
  {
    id: "displayName",
    label: "Your name",
    aiAsk: "What should I call you?",
    whyNeeded:
      "So I can address you by name and tag your account. We never share your name with other organizations without your explicit consent.",
    required: true,
  },
  {
    id: "businessOrPurpose",
    label: "Your business or purpose",
    aiAsk:
      "Tell me about your business, or what you would like to do with Borjie.",
    whyNeeded:
      "So I can match you to the right products and lenders. We use this to tailor recommendations, not to score you.",
    required: true,
  },
  {
    id: "regionOrCountry",
    label: "Region or country",
    aiAsk: "Which region or country are you in?",
    whyNeeded:
      "Different regions have different lending rules. We use this to show only relevant options.",
    required: true,
  },
  {
    id: "language",
    label: "Preferred language",
    aiAsk: "Would you like to continue in English or Swahili?",
    whyNeeded:
      "So everything I say to you, and every screen you see, matches your language.",
    required: false,
  },
  {
    id: "consentScope",
    label: "Privacy and consent",
    aiAsk:
      "Last thing: do you agree that I can carry our conversation so far into your new account, so we don't have to start over?",
    whyNeeded:
      "Tanzania PDPA Article 6 requires explicit consent before personal data crosses session boundaries.",
    required: true,
  },
] as const;

export function getNextField(state: OnboardingState): OnboardingField | null {
  for (const field of ONBOARDING_FIELDS) {
    if (state.fields[field.id] === undefined && field.required) {
      return field;
    }
    if (
      state.fields[field.id] === undefined &&
      !field.required &&
      state.currentStep === field.id
    ) {
      return field;
    }
  }
  return null;
}

export interface UpdateFieldInput {
  readonly state: OnboardingState;
  readonly fieldId: OnboardingFieldId;
  readonly value: string;
  readonly fromMessage: string;
  readonly confidence?: "high" | "medium" | "low";
  readonly clock?: () => Date;
}

/**
 * Pure state update: returns the NEW state with the field set + provenance
 * recorded. Never mutates the input.
 */
export function updateField(input: UpdateFieldInput): OnboardingState {
  const clock = input.clock ?? (() => new Date());
  const provenance: FieldProvenance = {
    fieldId: input.fieldId,
    extractedAt: clock().toISOString(),
    fromMessage: input.fromMessage,
    confidence: input.confidence ?? "high",
  };

  const newFields = {
    ...input.state.fields,
    [input.fieldId]: input.value,
  };
  const newProvenance = {
    ...input.state.provenance,
    [input.fieldId]: provenance,
  };

  // Advance currentStep to the next missing required field, or "confirm".
  const nextField = getNextField({
    ...input.state,
    fields: newFields,
    provenance: newProvenance,
  });
  const nextStep: OnboardingState["currentStep"] = nextField
    ? nextField.id
    : "confirm";

  return {
    ...input.state,
    fields: newFields,
    provenance: newProvenance,
    currentStep: nextStep,
  };
}

/**
 * Returns true when every required field is set and the visitor has
 * provided consent.
 */
export function isReadyToConfirm(state: OnboardingState): boolean {
  for (const field of ONBOARDING_FIELDS) {
    if (field.required && state.fields[field.id] === undefined) return false;
  }
  return true;
}

/**
 * Initial state for a fresh session.
 */
export function initialState(): OnboardingState {
  return {
    fields: {},
    provenance: {},
    currentStep: "displayName",
    affect: "neutral",
  };
}

/**
 * Build a confirmation banner the UI renders before creating the account.
 * Includes every field + provenance + a "look right?" prompt.
 */
export interface ConfirmationBanner {
  readonly summary: string;
  readonly rows: ReadonlyArray<{
    readonly label: string;
    readonly value: string;
    readonly provenanceText: string;
  }>;
  readonly ctaPrimary: string;
  readonly ctaSecondary: string;
}

export function buildConfirmationBanner(
  state: OnboardingState,
): ConfirmationBanner {
  const rows = ONBOARDING_FIELDS.filter(
    (f) => state.fields[f.id] !== undefined,
  ).map((f) => ({
    label: f.label,
    value: state.fields[f.id] ?? "",
    provenanceText: provenanceLine(state.provenance[f.id]),
  }));

  return {
    summary:
      "Here is what I learned about you. Look right? Confirm to create your account.",
    rows,
    ctaPrimary: "Confirm and create my account",
    ctaSecondary: "Let me edit something",
  };
}

function provenanceLine(prov: FieldProvenance | undefined): string {
  if (!prov) return "";
  const time = prov.extractedAt.slice(11, 16);
  return `From your message at ${time} (confidence: ${prov.confidence})`;
}

/**
 * Affect-aware register selector.
 *
 * If the visitor seems anxious about sharing data, the AI shifts to a
 * gentler register. Returns the recommended register hint that the
 * downstream prompt assembler can splice into the system prompt.
 */
export function selectRegister(
  affect: OnboardingState["affect"],
): "neutral" | "gentle" | "encouraging" | "matter-of-fact" {
  switch (affect) {
    case "anxious":
      return "gentle";
    case "frustrated":
      return "matter-of-fact";
    case "curious":
      return "encouraging";
    default:
      return "neutral";
  }
}
