// =============================================================================
// Voice Warmth Controller — Maps emotional state to ElevenLabs voice params
// Implements smooth transitions so voice never jumps abruptly between moods
// =============================================================================

import type {
  ElevenLabsGenerationParams,
  ElevenLabsVoiceParams,
  EmotionalState,
  EmotionType,
  TextModifier,
  VoiceConfig,
  VoiceEmphasis,
  VoiceWarmth,
} from "./types";

// ---------------------------------------------------------------------------
// Voice presets
// ---------------------------------------------------------------------------

const VOICE_PRESETS: Readonly<Record<string, VoiceConfig>> = {
  encouraging: {
    stability: 0.4,
    similarityBoost: 0.75,
    style: 0.6,
    speakingRate: 0.95,
    pitch: 1,
    warmth: "very_warm",
    emphasis: "encouraging",
  },
  celebrating: {
    stability: 0.3,
    similarityBoost: 0.7,
    style: 0.8,
    speakingRate: 1.05,
    pitch: 2,
    warmth: "very_warm",
    emphasis: "celebratory",
  },
  calm_support: {
    stability: 0.6,
    similarityBoost: 0.8,
    style: 0.4,
    speakingRate: 0.85,
    pitch: -1,
    warmth: "warm",
    emphasis: "gentle",
  },
  neutral_teaching: {
    stability: 0.5,
    similarityBoost: 0.75,
    style: 0.5,
    speakingRate: 1.0,
    pitch: 0,
    warmth: "neutral",
    emphasis: "normal",
  },
  energetic: {
    stability: 0.35,
    similarityBoost: 0.7,
    style: 0.7,
    speakingRate: 1.1,
    pitch: 2,
    warmth: "warm",
    emphasis: "encouraging",
  },
  soothing: {
    stability: 0.65,
    similarityBoost: 0.8,
    style: 0.3,
    speakingRate: 0.8,
    pitch: -2,
    warmth: "warm",
    emphasis: "gentle",
  },
  focused: {
    stability: 0.55,
    similarityBoost: 0.75,
    style: 0.45,
    speakingRate: 0.9,
    pitch: 0,
    warmth: "neutral",
    emphasis: "normal",
  },
};

// ---------------------------------------------------------------------------
// Emotion-to-preset mapping
// ---------------------------------------------------------------------------

const EMOTION_PRESET_MAP: Readonly<Record<EmotionType, string>> = {
  curious: "energetic",
  confident: "neutral_teaching",
  confused: "calm_support",
  frustrated: "soothing",
  excited: "celebrating",
  bored: "energetic",
  anxious: "calm_support",
  determined: "focused",
  neutral: "neutral_teaching",
};

// ---------------------------------------------------------------------------
// Warmth ordering for smooth transitions
// ---------------------------------------------------------------------------

const WARMTH_ORDER: readonly VoiceWarmth[] = [
  "cool",
  "neutral",
  "warm",
  "very_warm",
];

const EMPHASIS_ORDER: readonly VoiceEmphasis[] = [
  "gentle",
  "normal",
  "encouraging",
  "celebratory",
];

// ---------------------------------------------------------------------------
// Text modifier templates
// ---------------------------------------------------------------------------

const MODIFIER_TEMPLATES: Readonly<Record<string, readonly TextModifier[]>> = {
  frustrated: [
    {
      type: "empathy",
      insert: "before",
      templates: [
        "I can see this is challenging, and that's completely normal.",
        "This part trips up a lot of people. You're not alone.",
        "Take your time. There is no rush here.",
      ],
      templatesSw: [
        "Ninaona hii ni changamoto, na hiyo ni kawaida kabisa.",
        "Sehemu hii inawatatiza watu wengi. Huko si peke yako.",
        "Chukua muda wako. Hakuna haraka hapa.",
      ],
    },
    {
      type: "reassurance",
      insert: "after",
      templates: [
        "Would you like me to explain this differently?",
        "Let's try a different angle on this.",
        "We can come back to this later if you prefer.",
      ],
      templatesSw: [
        "Ungependa nikusaidie kueleza hii kwa njia tofauti?",
        "Tujaribu njia nyingine ya hii.",
        "Tunaweza kurudi hapa baadaye ukipenda.",
      ],
    },
  ],
  confused: [
    {
      type: "encouragement",
      insert: "before",
      templates: [
        "Great question. Let me break this down step by step.",
        "That's a really important point to understand. Here's how I think about it.",
      ],
      templatesSw: [
        "Swali zuri. Hebu tuvunje hii hatua kwa hatua.",
        "Hii ni muhimu sana kuelewa. Hivi ndivyo ninavyofikiri kuhusu hii.",
      ],
    },
  ],
  excited: [
    {
      type: "celebration",
      insert: "before",
      templates: [
        "Excellent work! You're really getting this!",
        "That's exactly right! You're on fire!",
        "Brilliant! Your understanding is really growing.",
      ],
      templatesSw: [
        "Kazi nzuri sana! Unaelewa vizuri!",
        "Sahihi kabisa! Umejaa nguvu!",
        "Bora! Ufahamu wako unakua kweli.",
      ],
    },
  ],
  confident: [
    {
      type: "challenge",
      insert: "after",
      templates: [
        "Ready for something a bit more challenging?",
        "You've got this down. Let's level up.",
      ],
      templatesSw: [
        "Uko tayari kwa changamoto zaidi?",
        "Umefaulu. Tupande ngazi.",
      ],
    },
  ],
  bored: [
    {
      type: "challenge",
      insert: "before",
      templates: [
        "Here's an interesting twist on this topic.",
        "Let me show you something surprising about this.",
      ],
      templatesSw: [
        "Hii ndiyo siri ya mada hii.",
        "Hebu nikuonyeshe kitu cha kushangaza kuhusu hii.",
      ],
    },
  ],
  anxious: [
    {
      type: "reassurance",
      insert: "before",
      templates: [
        "Making mistakes is how we learn. Every expert started here.",
        "There's no wrong answer in this conversation. Let's explore together.",
      ],
      templatesSw: [
        "Kufanya makosa ndivyo tunavyojifunza. Kila mtaalamu alianza hapa.",
        "Hakuna jibu baya katika mazungumzo haya. Tuchunguze pamoja.",
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getVoiceConfigForEmotion(
  emotionalState: EmotionalState,
): VoiceConfig {
  const presetKey = EMOTION_PRESET_MAP[emotionalState.current];
  const baseConfig = VOICE_PRESETS[presetKey];

  // Adjust based on frustration intensity
  if (emotionalState.frustrationLevel >= 7) {
    return {
      ...baseConfig,
      speakingRate: Math.max(0.75, baseConfig.speakingRate - 0.1),
      stability: Math.min(0.7, baseConfig.stability + 0.1),
      warmth: "very_warm",
      emphasis: "gentle",
    };
  }

  // Adjust based on high engagement
  if (emotionalState.engagementLevel >= 8) {
    return {
      ...baseConfig,
      style: Math.min(1, baseConfig.style + 0.1),
      speakingRate: Math.min(1.15, baseConfig.speakingRate + 0.05),
    };
  }

  return baseConfig;
}

export function transitionVoice(
  current: VoiceConfig,
  target: VoiceConfig,
  smoothing: number = 0.3,
): VoiceConfig {
  const clampedSmoothing = Math.max(0.1, Math.min(1.0, smoothing));

  return {
    stability: lerp(current.stability, target.stability, clampedSmoothing),
    similarityBoost: lerp(
      current.similarityBoost,
      target.similarityBoost,
      clampedSmoothing,
    ),
    style: lerp(current.style, target.style, clampedSmoothing),
    speakingRate: lerp(
      current.speakingRate,
      target.speakingRate,
      clampedSmoothing,
    ),
    pitch: lerp(current.pitch, target.pitch, clampedSmoothing),
    warmth: transitionWarmth(current.warmth, target.warmth),
    emphasis: transitionEmphasis(current.emphasis, target.emphasis),
  };
}

export function getTextModifiers(
  emotionalState: EmotionalState,
): readonly TextModifier[] {
  const modifiers = MODIFIER_TEMPLATES[emotionalState.current];
  if (!modifiers) return [];

  // Filter to most relevant modifier based on frustration level
  if (emotionalState.frustrationLevel >= 5) {
    const empathyModifiers = modifiers.filter(
      (m) => m.type === "empathy" || m.type === "reassurance",
    );
    return empathyModifiers.length > 0 ? empathyModifiers : modifiers;
  }

  return modifiers;
}

export function prosodyToElevenLabsParams(
  config: VoiceConfig,
): ElevenLabsGenerationParams {
  const voiceSettings: ElevenLabsVoiceParams = {
    stability: clamp(config.stability, 0, 1),
    similarity_boost: clamp(config.similarityBoost, 0, 1),
    style: clamp(config.style, 0, 1),
    use_speaker_boost:
      config.warmth === "very_warm" || config.warmth === "warm",
  };

  return {
    voice_settings: voiceSettings,
    model_id: process.env.ELEVENLABS_MODEL_TTS || "eleven_v3",
  };
}

export function getDefaultVoiceConfig(): VoiceConfig {
  return { ...VOICE_PRESETS.neutral_teaching };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function lerp(a: number, b: number, t: number): number {
  return Math.round((a + (b - a) * t) * 1000) / 1000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function transitionWarmth(
  current: VoiceWarmth,
  target: VoiceWarmth,
): VoiceWarmth {
  const currentIdx = WARMTH_ORDER.indexOf(current);
  const targetIdx = WARMTH_ORDER.indexOf(target);

  // Only step one level at a time (never jump from cool to very_warm)
  if (targetIdx > currentIdx) {
    return WARMTH_ORDER[currentIdx + 1];
  }
  if (targetIdx < currentIdx) {
    return WARMTH_ORDER[currentIdx - 1];
  }
  return current;
}

function transitionEmphasis(
  current: VoiceEmphasis,
  target: VoiceEmphasis,
): VoiceEmphasis {
  const currentIdx = EMPHASIS_ORDER.indexOf(current);
  const targetIdx = EMPHASIS_ORDER.indexOf(target);

  if (targetIdx > currentIdx) {
    return EMPHASIS_ORDER[currentIdx + 1];
  }
  if (targetIdx < currentIdx) {
    return EMPHASIS_ORDER[currentIdx - 1];
  }
  return current;
}
