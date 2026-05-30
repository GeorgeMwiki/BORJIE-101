// =============================================================================
// Frustration Detector — Text-based emotional signal analysis
// Detects frustration, engagement, and emotional state from chat messages
// without camera or microphone (pure NLP / heuristic approach)
// =============================================================================

import type {
  AnalyzableMessage,
  EmotionalState,
  EmotionSnapshot,
  EmotionTrend,
  EmotionType,
  FrustrationContext,
  FrustrationSignal,
  FrustrationSignalKind,
  ProsodyPromptContext,
  QuizResult,
} from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TERSE_THRESHOLD = 15; // characters
const LONG_PAUSE_MS = 120_000; // 2 minutes
const RESPONSE_WINDOW = 8; // analyze last N user messages
const FRUSTRATION_DECAY = 0.85; // older signals decay
const MAX_HISTORY = 50;

const TERSE_WORDS: ReadonlySet<string> = new Set([
  "ok",
  "okay",
  "fine",
  "sure",
  "yes",
  "no",
  "idk",
  "whatever",
  "k",
  "ya",
  "nah",
  "meh",
  "hmm",
  "sawa",
  "ndiyo",
  "hapana",
  "haya",
]);

const EN_FRUSTRATION_PHRASES: readonly string[] = [
  "i don't understand",
  "i don't get it",
  "this is confusing",
  "this makes no sense",
  "i'm lost",
  "i give up",
  "too hard",
  "too difficult",
  "what do you mean",
  "you already said that",
  "this is stupid",
  "i'm stuck",
  "help me",
  "can you explain again",
  "i keep getting it wrong",
  "why is this so hard",
];

const SW_FRUSTRATION_PHRASES: readonly string[] = [
  "sina uwezo",
  "sielewi",
  "ni ngumu sana",
  "ni ngumu",
  "sifanyi vizuri",
  "naomba msaada",
  "niko confused",
  "sijui",
  "hii ni ngumu",
  "siwezi kuelewa",
  "nakata tamaa",
  "nimechoka",
  "eleza tena",
  "sielewi kabisa",
  "ni vigumu",
];

const TOPIC_AVOIDANCE_PHRASES: readonly string[] = [
  "skip",
  "next",
  "move on",
  "something else",
  "different topic",
  "can we change",
  "let's do something else",
  "ruka",
  "ifuatayo",
  "kingine",
];

// ---------------------------------------------------------------------------
// Signal detection functions
// ---------------------------------------------------------------------------

function detectTerseResponses(
  messages: readonly AnalyzableMessage[],
): readonly FrustrationSignal[] {
  const userMessages = messages.filter((m) => m.role === "user");
  const recent = userMessages.slice(-RESPONSE_WINDOW);

  return recent
    .filter((m) => {
      const trimmed = m.content.trim().toLowerCase();
      return (
        trimmed.length <= TERSE_THRESHOLD ||
        TERSE_WORDS.has(trimmed.replace(/[.!?,]/g, ""))
      );
    })
    .map((m) => ({
      kind: "terse_response" as FrustrationSignalKind,
      weight: 0.3,
      evidence: m.content.trim(),
      detectedAt: m.timestamp,
    }));
}

function detectExplicitFrustration(
  messages: readonly AnalyzableMessage[],
): readonly FrustrationSignal[] {
  const userMessages = messages.filter((m) => m.role === "user");
  const recent = userMessages.slice(-RESPONSE_WINDOW);
  const allPhrases = [...EN_FRUSTRATION_PHRASES, ...SW_FRUSTRATION_PHRASES];

  return recent.flatMap((m) => {
    const lower = m.content.toLowerCase();
    const matches = allPhrases.filter((phrase) => lower.includes(phrase));
    return matches.map((phrase) => ({
      kind: (SW_FRUSTRATION_PHRASES.includes(phrase)
        ? "swahili_frustration"
        : "explicit_frustration") as FrustrationSignalKind,
      weight: 0.7,
      evidence: phrase,
      detectedAt: m.timestamp,
    }));
  });
}

function detectRepeatedErrors(
  quizResults: readonly QuizResult[],
): readonly FrustrationSignal[] {
  const conceptAttempts = new Map<string, number>();

  for (const result of quizResults) {
    if (!result.correct) {
      const count = (conceptAttempts.get(result.conceptId) ?? 0) + 1;
      conceptAttempts.set(result.conceptId, count);
    }
  }

  return Array.from(conceptAttempts.entries())
    .filter(([, count]) => count >= 2)
    .map(([conceptId, count]) => ({
      kind: "repeated_incorrect" as FrustrationSignalKind,
      weight: Math.min(0.9, 0.3 + count * 0.2),
      evidence: `${count} failures on concept ${conceptId}`,
      detectedAt: new Date(),
    }));
}

function detectLongPauses(
  messages: readonly AnalyzableMessage[],
): readonly FrustrationSignal[] {
  const userMessages = messages.filter((m) => m.role === "user");
  if (userMessages.length < 2) return [];

  const signals: FrustrationSignal[] = [];
  for (let i = 1; i < userMessages.length; i++) {
    const gap =
      userMessages[i].timestamp.getTime() -
      userMessages[i - 1].timestamp.getTime();
    if (gap >= LONG_PAUSE_MS) {
      signals.push({
        kind: "long_pause",
        weight: Math.min(0.6, 0.2 + (gap / LONG_PAUSE_MS) * 0.15),
        evidence: `${Math.round(gap / 1000)}s gap`,
        detectedAt: userMessages[i].timestamp,
      });
    }
  }

  return signals;
}

function detectResponseDegradation(
  messages: readonly AnalyzableMessage[],
): readonly FrustrationSignal[] {
  const userMessages = messages
    .filter((m) => m.role === "user")
    .slice(-RESPONSE_WINDOW);

  if (userMessages.length < 4) return [];

  const half = Math.floor(userMessages.length / 2);
  const firstHalf = userMessages.slice(0, half);
  const secondHalf = userMessages.slice(half);

  const avgFirst =
    firstHalf.reduce((sum, m) => sum + m.content.length, 0) / firstHalf.length;
  const avgSecond =
    secondHalf.reduce((sum, m) => sum + m.content.length, 0) /
    secondHalf.length;

  if (avgFirst > 0 && avgSecond / avgFirst < 0.5) {
    return [
      {
        kind: "response_degradation",
        weight: 0.5,
        evidence: `avg length dropped from ${Math.round(avgFirst)} to ${Math.round(avgSecond)} chars`,
        detectedAt: new Date(),
      },
    ];
  }

  return [];
}

function detectQuestionRepetition(
  messages: readonly AnalyzableMessage[],
): readonly FrustrationSignal[] {
  const userMessages = messages
    .filter((m) => m.role === "user")
    .slice(-RESPONSE_WINDOW);

  const normalized = userMessages.map((m) =>
    m.content
      .toLowerCase()
      .replace(/[?!.,]/g, "")
      .trim(),
  );

  const seen = new Map<string, number>();
  const signals: FrustrationSignal[] = [];

  for (let i = 0; i < normalized.length; i++) {
    const text = normalized[i];
    if (text.length < 5) continue;

    const previousIndex = seen.get(text);
    if (previousIndex !== undefined) {
      signals.push({
        kind: "question_repetition",
        weight: 0.6,
        evidence: text,
        detectedAt: userMessages[i].timestamp,
      });
    }
    seen.set(text, i);
  }

  return signals;
}

function detectTopicAvoidance(
  messages: readonly AnalyzableMessage[],
): readonly FrustrationSignal[] {
  const userMessages = messages
    .filter((m) => m.role === "user")
    .slice(-RESPONSE_WINDOW);

  return userMessages
    .filter((m) => {
      const lower = m.content.toLowerCase();
      return TOPIC_AVOIDANCE_PHRASES.some((phrase) => lower.includes(phrase));
    })
    .map((m) => ({
      kind: "topic_avoidance" as FrustrationSignalKind,
      weight: 0.4,
      evidence: m.content.trim(),
      detectedAt: m.timestamp,
    }));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function detectFrustration(
  messages: readonly AnalyzableMessage[],
  context: FrustrationContext,
): readonly FrustrationSignal[] {
  const signals: readonly FrustrationSignal[] = [
    ...detectTerseResponses(messages),
    ...detectExplicitFrustration(messages),
    ...detectRepeatedErrors(context.recentQuizResults),
    ...detectLongPauses(messages),
    ...detectResponseDegradation(messages),
    ...detectQuestionRepetition(messages),
    ...detectTopicAvoidance(messages),
  ];

  return signals;
}

export function calculateFrustrationLevel(
  signals: readonly FrustrationSignal[],
): number {
  if (signals.length === 0) return 0;

  const now = Date.now();
  const weightedSum = signals.reduce((sum, signal) => {
    const ageMs = now - signal.detectedAt.getTime();
    const ageMinutes = ageMs / 60_000;
    const decay = Math.pow(FRUSTRATION_DECAY, ageMinutes / 5);
    return sum + signal.weight * decay;
  }, 0);

  return Math.min(10, Math.round(weightedSum * 10) / 10);
}

export function detectEngagement(
  messages: readonly AnalyzableMessage[],
): number {
  const userMessages = messages
    .filter((m) => m.role === "user")
    .slice(-RESPONSE_WINDOW);

  if (userMessages.length === 0) return 5;

  let score = 5;

  // Longer responses indicate engagement
  const avgLength =
    userMessages.reduce((s, m) => s + m.content.length, 0) /
    userMessages.length;
  if (avgLength > 80) score += 2;
  else if (avgLength > 40) score += 1;
  else if (avgLength < 10) score -= 2;

  // Questions indicate curiosity
  const questionCount = userMessages.filter((m) =>
    m.content.includes("?"),
  ).length;
  score += Math.min(2, questionCount * 0.5);

  // Rapid responses indicate engagement
  if (userMessages.length >= 2) {
    const gaps: number[] = [];
    for (let i = 1; i < userMessages.length; i++) {
      gaps.push(
        userMessages[i].timestamp.getTime() -
          userMessages[i - 1].timestamp.getTime(),
      );
    }
    const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    if (avgGap < 30_000) score += 1;
    if (avgGap > 180_000) score -= 1;
  }

  return Math.max(0, Math.min(10, Math.round(score * 10) / 10));
}

export function inferEmotionalState(
  messages: readonly AnalyzableMessage[],
  quizResults: readonly QuizResult[],
  context: FrustrationContext,
): EmotionalState {
  const signals = detectFrustration(messages, context);
  const frustrationLevel = calculateFrustrationLevel(signals);
  const engagementLevel = detectEngagement(messages);

  const current = inferPrimaryEmotion(
    frustrationLevel,
    engagementLevel,
    quizResults,
    messages,
  );
  const history = buildEmotionHistory(signals, quizResults);
  const trend = getEmotionalTrend(history);

  const confidence = computeConfidence(messages.length, signals.length);

  return {
    current,
    confidence,
    trend,
    frustrationLevel,
    engagementLevel,
    history: history.slice(-MAX_HISTORY),
  };
}

export function getEmotionalTrend(
  history: readonly EmotionSnapshot[],
): EmotionTrend {
  if (history.length < 3) return "stable";

  const recent = history.slice(-5);
  const positiveEmotions: ReadonlySet<EmotionType> = new Set<EmotionType>([
    "curious",
    "confident",
    "excited",
    "determined",
  ]);
  const negativeEmotions: ReadonlySet<EmotionType> = new Set<EmotionType>([
    "frustrated",
    "confused",
    "bored",
    "anxious",
  ]);

  const firstHalf = recent.slice(0, Math.floor(recent.length / 2));
  const secondHalf = recent.slice(Math.floor(recent.length / 2));

  const firstPositiveRatio =
    firstHalf.filter((s) => positiveEmotions.has(s.emotion)).length /
    Math.max(1, firstHalf.length);
  const secondPositiveRatio =
    secondHalf.filter((s) => positiveEmotions.has(s.emotion)).length /
    Math.max(1, secondHalf.length);

  const firstNegativeRatio =
    firstHalf.filter((s) => negativeEmotions.has(s.emotion)).length /
    Math.max(1, firstHalf.length);
  const secondNegativeRatio =
    secondHalf.filter((s) => negativeEmotions.has(s.emotion)).length /
    Math.max(1, secondHalf.length);

  if (secondPositiveRatio > firstPositiveRatio + 0.2) return "improving";
  if (secondNegativeRatio > firstNegativeRatio + 0.2) return "declining";

  return "stable";
}

export function frustrationToPromptContext(
  state: EmotionalState,
): ProsodyPromptContext {
  const { frustrationLevel, engagementLevel, current, trend } = state;

  const encouragementLevel = mapEncouragementLevel(frustrationLevel);
  const sentenceLengthGuide = mapSentenceLength(frustrationLevel);
  const referencePriorSuccess = frustrationLevel >= 4;
  const suggestAlternativeApproach = frustrationLevel >= 6;

  const textPrefixes = buildPrefixes(current, frustrationLevel);
  const textSuffixes = buildSuffixes(current, engagementLevel);
  const teachingAdjustments = buildTeachingAdjustments(
    frustrationLevel,
    engagementLevel,
    trend,
    current,
  );

  const toneDirective = buildToneDirective(
    current,
    frustrationLevel,
    engagementLevel,
    trend,
  );

  return {
    toneDirective,
    sentenceLengthGuide,
    encouragementLevel,
    referencePriorSuccess,
    suggestAlternativeApproach,
    textPrefixes,
    textSuffixes,
    teachingAdjustments,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function inferPrimaryEmotion(
  frustration: number,
  engagement: number,
  quizResults: readonly QuizResult[],
  messages: readonly AnalyzableMessage[],
): EmotionType {
  if (frustration >= 7) return "frustrated";
  if (frustration >= 5 && engagement < 4) return "anxious";

  const recentQuizzes = quizResults.slice(-3);
  const recentCorrect = recentQuizzes.filter((q) => q.correct).length;

  if (recentCorrect === recentQuizzes.length && recentQuizzes.length >= 2) {
    return "confident";
  }

  if (engagement < 3) return "bored";
  if (frustration >= 4) return "confused";

  const lastMessage = messages.filter((m) => m.role === "user").slice(-1)[0];
  if (lastMessage && lastMessage.content.includes("?") && engagement >= 6) {
    return "curious";
  }

  if (recentCorrect >= 2 && engagement >= 7) return "excited";
  if (frustration >= 3 && engagement >= 6) return "determined";

  return "neutral";
}

function buildEmotionHistory(
  signals: readonly FrustrationSignal[],
  quizResults: readonly QuizResult[],
): readonly EmotionSnapshot[] {
  const snapshots: EmotionSnapshot[] = [];

  for (const signal of signals) {
    const emotion = signalToEmotion(signal.kind);
    snapshots.push({
      emotion,
      timestamp: signal.detectedAt,
      trigger: signalToTrigger(signal.kind),
      intensity: Math.round(signal.weight * 10),
    });
  }

  for (const result of quizResults.slice(-5)) {
    snapshots.push({
      emotion: result.correct ? "confident" : "confused",
      timestamp: result.timestamp,
      trigger: result.correct ? "quiz_success" : "quiz_fail",
      intensity: result.correct ? 7 : 5,
    });
  }

  return [...snapshots].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
  );
}

function signalToEmotion(kind: FrustrationSignal["kind"]): EmotionType {
  const mapping: Record<FrustrationSignal["kind"], EmotionType> = {
    terse_response: "bored",
    repeated_incorrect: "frustrated",
    long_pause: "confused",
    explicit_frustration: "frustrated",
    question_repetition: "confused",
    response_degradation: "bored",
    topic_avoidance: "anxious",
    swahili_frustration: "frustrated",
  };
  return mapping[kind];
}

function signalToTrigger(
  kind: FrustrationSignal["kind"],
): EmotionSnapshot["trigger"] {
  const mapping: Record<FrustrationSignal["kind"], EmotionSnapshot["trigger"]> =
    {
      terse_response: "short_response",
      repeated_incorrect: "repeated_error",
      long_pause: "long_pause",
      explicit_frustration: "help_request",
      question_repetition: "concept_struggle",
      response_degradation: "short_response",
      topic_avoidance: "topic_change",
      swahili_frustration: "help_request",
    };
  return mapping[kind];
}

function computeConfidence(messageCount: number, signalCount: number): number {
  const dataPoints = messageCount + signalCount;
  if (dataPoints < 3) return 0.3;
  if (dataPoints < 6) return 0.5;
  if (dataPoints < 10) return 0.7;
  return 0.85;
}

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

function buildPrefixes(
  emotion: EmotionType,
  frustration: number,
): readonly string[] {
  const prefixes: string[] = [];

  if (frustration >= 5) {
    prefixes.push("That's a tricky one, and you're doing well to keep going.");
    prefixes.push("Take your time with this.");
  }

  if (emotion === "confused") {
    prefixes.push("Let me explain this differently.");
  }

  if (emotion === "frustrated") {
    prefixes.push("I can see this is challenging. Let's break it down.");
  }

  return prefixes;
}

function buildSuffixes(
  emotion: EmotionType,
  engagement: number,
): readonly string[] {
  const suffixes: string[] = [];

  if (emotion === "confident" || emotion === "excited") {
    suffixes.push("You're making great progress.");
  }

  if (engagement < 4) {
    suffixes.push("Would you like to try something different?");
  }

  return suffixes;
}

function buildTeachingAdjustments(
  frustration: number,
  engagement: number,
  trend: EmotionTrend,
  emotion: EmotionType,
): readonly string[] {
  const adjustments: string[] = [];

  if (frustration >= 6) {
    adjustments.push("Use shorter sentences and simpler vocabulary");
    adjustments.push("Break the concept into smaller steps");
    adjustments.push("Offer a concrete example before the abstract rule");
  }

  if (frustration >= 4) {
    adjustments.push("Lead with encouragement before corrections");
    adjustments.push("Reference a recent success to build confidence");
  }

  if (engagement < 4) {
    adjustments.push("Ask an engaging question to regain attention");
    adjustments.push("Connect the topic to a real-world scenario");
  }

  if (trend === "declining") {
    adjustments.push("Suggest a short break or a change of topic");
  }

  if (emotion === "anxious") {
    adjustments.push("Reassure that making mistakes is part of learning");
    adjustments.push("Normalize the difficulty of this topic");
  }

  if (emotion === "bored") {
    adjustments.push("Increase challenge level or introduce a quiz");
    adjustments.push("Present a surprising fact or counterintuitive example");
  }

  return adjustments;
}

function buildToneDirective(
  emotion: EmotionType,
  frustration: number,
  engagement: number,
  trend: EmotionTrend,
): string {
  const parts: string[] = [];

  parts.push(
    `Learner is showing signs of ${emotion} (frustration ${frustration}/10, engagement ${engagement}/10, trend: ${trend}).`,
  );

  if (frustration >= 6) {
    parts.push(
      "Use a warm, patient, supportive tone. Keep sentences short. Lead with encouragement.",
    );
  } else if (frustration >= 3) {
    parts.push(
      "Use a gently encouraging tone. Acknowledge difficulty without dwelling on it.",
    );
  } else if (engagement >= 7) {
    parts.push("Match their energy with an enthusiastic, forward-moving tone.");
  } else {
    parts.push("Maintain a clear, friendly teaching tone.");
  }

  if (frustration >= 4) {
    parts.push("Ask if they want to try a different approach.");
  }

  return parts.join(" ");
}
