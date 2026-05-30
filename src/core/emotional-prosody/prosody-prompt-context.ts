// =============================================================================
// Prosody Prompt Context — Generates AI prompt adjustments from emotional state
// Produces bilingual (EN/SW) tone directives and teaching modifications
// =============================================================================

import type {
  EmotionalState,
  EmotionType,
  ProsodyProfile,
  ProsodyPromptContext,
  TextModifier,
} from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EMOTION_LABELS_EN: Readonly<Record<EmotionType, string>> = {
  curious: "curious and engaged",
  confident: "confident and progressing well",
  confused: "confused and uncertain",
  frustrated: "frustrated and struggling",
  excited: "excited and energized",
  bored: "disengaged and losing interest",
  anxious: "anxious about their performance",
  determined: "determined but challenged",
  neutral: "in a neutral, steady state",
};

const EMOTION_LABELS_SW: Readonly<Record<EmotionType, string>> = {
  curious: "na udadisi na ushiriki",
  confident: "na ujasiri na maendeleo mazuri",
  confused: "na mkanganyiko",
  frustrated: "na kukata tamaa",
  excited: "na msisimko na nguvu",
  bored: "amepoteza hamu",
  anxious: "na wasiwasi kuhusu utendaji wao",
  determined: "na azimio lakini changamoto",
  neutral: "katika hali ya kawaida",
};

// ---------------------------------------------------------------------------
// Tone directives per emotion
// ---------------------------------------------------------------------------

const TONE_DIRECTIVES: Readonly<Record<EmotionType, string>> = {
  curious:
    "Feed their curiosity. Provide depth and invite exploration. Ask thought-provoking follow-up questions.",
  confident:
    "Maintain their momentum. Introduce slightly harder material. Acknowledge their skill without over-praising.",
  confused:
    "Slow down. Use simpler language. Break concepts into smaller steps. Provide a concrete example first, then the abstract rule.",
  frustrated:
    "Use a warm, patient, supportive tone. Keep sentences very short. Lead with encouragement. Offer to try a different approach. Reference a recent success.",
  excited:
    "Match their energy. Celebrate progress. Channel excitement into the next challenge. Use enthusiastic but focused language.",
  bored:
    "Re-engage with something unexpected. Pose a real-world problem. Increase the challenge. Ask a surprising question.",
  anxious:
    "Reassure them. Normalize mistakes. Use calming language. Reduce pressure by removing time constraints. Celebrate small wins.",
  determined:
    "Support their persistence. Provide clear next steps. Acknowledge the difficulty while reinforcing they can overcome it.",
  neutral:
    "Use a clear, friendly teaching tone. Maintain balanced pacing. Provide structured explanations.",
};

// ---------------------------------------------------------------------------
// Teaching adjustments per emotional state
// ---------------------------------------------------------------------------

function buildTeachingAdjustments(state: EmotionalState): readonly string[] {
  const { current, frustrationLevel, engagementLevel, trend } = state;
  const adjustments: string[] = [];

  // Frustration-based adjustments
  if (frustrationLevel >= 7) {
    adjustments.push("Switch to the simplest possible explanation");
    adjustments.push("Use a real-world analogy before any abstract concept");
    adjustments.push("Limit each response to ONE key idea");
    adjustments.push(
      "End every response with an encouraging, optional question",
    );
  } else if (frustrationLevel >= 4) {
    adjustments.push("Shorten explanations and use bullet points");
    adjustments.push(
      "Reference something they already mastered to build confidence",
    );
    adjustments.push("Ask if they want to revisit prerequisites");
  }

  // Engagement-based adjustments
  if (engagementLevel < 3) {
    adjustments.push(
      "Start with a question that connects the topic to their business",
    );
    adjustments.push(
      "Introduce a mini-challenge or scenario instead of lecture",
    );
  } else if (engagementLevel >= 8) {
    adjustments.push("They are highly engaged; maintain pace and depth");
  }

  // Trend-based adjustments
  if (trend === "declining") {
    adjustments.push(
      "Emotional trend is declining; consider suggesting a break or topic change",
    );
    adjustments.push("Reduce complexity and increase encouragement frequency");
  } else if (trend === "improving") {
    adjustments.push(
      "Emotional trend is improving; gradually increase challenge level",
    );
  }

  // Emotion-specific additions
  if (current === "anxious") {
    adjustments.push(
      "Explicitly state that mistakes are valuable learning signals",
    );
    adjustments.push("Remove any time pressure or urgency language");
  }

  if (current === "bored") {
    adjustments.push("Pose a counterintuitive question about the topic");
    adjustments.push("Connect content to Tanzania-specific business examples");
  }

  if (current === "confused") {
    adjustments.push("Check if they understood the prerequisite concept first");
    adjustments.push(
      "Offer to explain using a different method (visual, example, analogy)",
    );
  }

  return adjustments;
}

// ---------------------------------------------------------------------------
// Bilingual text prefix/suffix builders
// ---------------------------------------------------------------------------

function buildTextPrefixes(
  state: EmotionalState,
  language: "en" | "sw",
): readonly string[] {
  const { current, frustrationLevel } = state;

  if (language === "sw") {
    return buildSwahiliPrefixes(current, frustrationLevel);
  }

  return buildEnglishPrefixes(current, frustrationLevel);
}

function buildEnglishPrefixes(
  emotion: EmotionType,
  frustration: number,
): readonly string[] {
  const prefixes: string[] = [];

  if (frustration >= 6) {
    prefixes.push(
      "I appreciate you sticking with this. Let's take it one step at a time.",
    );
  }

  if (emotion === "confused") {
    prefixes.push("No worries. Let me explain this in a different way.");
  }

  if (emotion === "frustrated") {
    prefixes.push(
      "I hear you. This is genuinely a tough concept. Let's simplify it.",
    );
  }

  if (emotion === "excited") {
    prefixes.push("Love the energy! Let's keep that momentum going.");
  }

  if (emotion === "anxious") {
    prefixes.push(
      "You're doing better than you think. Let's work through this together.",
    );
  }

  return prefixes;
}

function buildSwahiliPrefixes(
  emotion: EmotionType,
  frustration: number,
): readonly string[] {
  const prefixes: string[] = [];

  if (frustration >= 6) {
    prefixes.push(
      "Nashukuru kwa uvumilivu wako. Tuchukue hatua moja kwa moja.",
    );
  }

  if (emotion === "confused") {
    prefixes.push("Usijali. Hebu nieleze hii kwa njia nyingine.");
  }

  if (emotion === "frustrated") {
    prefixes.push("Nakusikia. Hii ni dhana ngumu kweli. Tuirahisishe.");
  }

  if (emotion === "excited") {
    prefixes.push("Nguvu nzuri! Tuendelee na kasi hii.");
  }

  if (emotion === "anxious") {
    prefixes.push("Unafanya vizuri kuliko unavyofikiri. Tufanye kazi pamoja.");
  }

  return prefixes;
}

function buildTextSuffixes(
  state: EmotionalState,
  language: "en" | "sw",
): readonly string[] {
  const { current, engagementLevel } = state;

  if (language === "sw") {
    return buildSwahiliSuffixes(current, engagementLevel);
  }

  return buildEnglishSuffixes(current, engagementLevel);
}

function buildEnglishSuffixes(
  emotion: EmotionType,
  engagement: number,
): readonly string[] {
  const suffixes: string[] = [];

  if (emotion === "confident" || emotion === "excited") {
    suffixes.push("You're making excellent progress!");
  }

  if (engagement < 4) {
    suffixes.push("Would you like to try a different approach?");
  }

  if (emotion === "determined") {
    suffixes.push("Your persistence is paying off.");
  }

  return suffixes;
}

function buildSwahiliSuffixes(
  emotion: EmotionType,
  engagement: number,
): readonly string[] {
  const suffixes: string[] = [];

  if (emotion === "confident" || emotion === "excited") {
    suffixes.push("Unafanya maendeleo mazuri sana!");
  }

  if (engagement < 4) {
    suffixes.push("Ungependa kujaribu njia tofauti?");
  }

  if (emotion === "determined") {
    suffixes.push("Uvumilivu wako unazaa matunda.");
  }

  return suffixes;
}

// ---------------------------------------------------------------------------
// Prompt context helpers
// ---------------------------------------------------------------------------

function mapEncouragementLevel(
  frustration: number,
): ProsodyPromptContext["encouragementLevel"] {
  if (frustration >= 7) return "heavy";
  if (frustration >= 4) return "moderate";
  if (frustration >= 2) return "light";
  return "none";
}

function mapSentenceLength(
  frustration: number,
): ProsodyPromptContext["sentenceLengthGuide"] {
  if (frustration >= 6) return "short";
  if (frustration >= 3) return "medium";
  return "normal";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function prosodyToPromptContext(
  profile: ProsodyProfile,
  language: "en" | "sw" = "en",
): string {
  const { emotionalState, textModifiers } = profile;
  const { current, frustrationLevel, engagementLevel, trend, confidence } =
    emotionalState;

  const parts: string[] = [];

  // Emotional state summary
  const emotionLabel =
    language === "sw" ? EMOTION_LABELS_SW[current] : EMOTION_LABELS_EN[current];

  parts.push(
    `[EMOTIONAL PROSODY] The learner is ${emotionLabel} (frustration: ${frustrationLevel}/10, engagement: ${engagementLevel}/10, trend: ${trend}, detection confidence: ${Math.round(confidence * 100)}%).`,
  );

  // Tone directive
  parts.push(`TONE: ${TONE_DIRECTIVES[current]}`);

  // Teaching adjustments
  const adjustments = buildTeachingAdjustments(emotionalState);
  if (adjustments.length > 0) {
    parts.push(`TEACHING ADJUSTMENTS:\n- ${adjustments.join("\n- ")}`);
  }

  // Sentence length guide
  const sentenceGuide = mapSentenceLength(frustrationLevel);
  if (sentenceGuide !== "normal") {
    parts.push(
      `SENTENCE LENGTH: Use ${sentenceGuide} sentences (frustration is elevated).`,
    );
  }

  // Encouragement level
  const encouragement = mapEncouragementLevel(frustrationLevel);
  if (encouragement !== "none") {
    parts.push(
      `ENCOURAGEMENT: Apply ${encouragement} encouragement in responses.`,
    );
  }

  // Prior success reference
  if (frustrationLevel >= 4) {
    parts.push(
      "CONFIDENCE BOOST: Reference a recent concept or quiz they mastered.",
    );
  }

  // Alternative approach
  if (frustrationLevel >= 6) {
    parts.push(
      "ALTERNATIVE: Suggest trying a different learning approach (example, analogy, visual, step-by-step).",
    );
  }

  // Text modifier templates (for the AI to choose from)
  if (textModifiers.length > 0) {
    const modifierLines = textModifiers.flatMap((m: TextModifier) => {
      const templates = language === "sw" ? m.templatesSw : m.templates;
      return templates.map((t: string) => `  [${m.type}/${m.insert}] "${t}"`);
    });
    if (modifierLines.length > 0) {
      parts.push(
        `SUGGESTED PHRASES (choose one or adapt):\n${modifierLines.join("\n")}`,
      );
    }
  }

  // Text prefixes and suffixes
  const prefixes = buildTextPrefixes(emotionalState, language);
  const suffixes = buildTextSuffixes(emotionalState, language);

  if (prefixes.length > 0) {
    parts.push(`OPENING OPTIONS: ${prefixes.map((p) => `"${p}"`).join(" | ")}`);
  }

  if (suffixes.length > 0) {
    parts.push(`CLOSING OPTIONS: ${suffixes.map((s) => `"${s}"`).join(" | ")}`);
  }

  return parts.join("\n\n");
}

export function buildMinimalPromptContext(
  emotionalState: EmotionalState,
): string {
  const { current, frustrationLevel, engagementLevel } = emotionalState;

  if (frustrationLevel < 2 && engagementLevel >= 5) {
    return ""; // No adjustment needed when learner is doing well
  }

  return `[PROSODY] Learner: ${EMOTION_LABELS_EN[current]} (frustration ${frustrationLevel}/10). ${TONE_DIRECTIVES[current]}`;
}

export function shouldInjectProsody(emotionalState: EmotionalState): boolean {
  const { frustrationLevel, engagementLevel, current } = emotionalState;

  // Always inject when frustration is notable
  if (frustrationLevel >= 3) return true;

  // Inject for low engagement
  if (engagementLevel < 4) return true;

  // Inject for strong positive emotions (to maintain them)
  if (current === "excited" || current === "curious") return true;

  // Inject for anxious learners
  if (current === "anxious") return true;

  return false;
}
