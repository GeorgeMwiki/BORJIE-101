/**
 * Voice Capture Types
 * Ported verbatim from LitFin src/core/voice-capture/types.ts with Borjie
 * domain swap (borrower/officer roles -> owner/manager/employee/buyer).
 */

export type VoiceRecordingStatus =
  | 'idle'
  | 'requesting-permission'
  | 'recording'
  | 'paused'
  | 'processing'
  | 'transcribing'
  | 'complete'
  | 'error';

export type TranscriptionProvider =
  | 'browser'
  | 'whisper'
  | 'deepgram'
  | 'assembly';

export interface VoiceRecordingConfig {
  maxDurationMs: number;
  sampleRate: number;
  channels: number;
  mimeType: string;
  transcriptionProvider: TranscriptionProvider;
  language: string; // BCP 47 — default 'sw-TZ' for Swahili/Tanzania (Borjie-first)
  enablePunctuation: boolean;
  enableSpeakerDiarization: boolean;
  autoStopOnSilence: boolean;
  silenceThresholdMs: number;
}

export interface VoiceRecording {
  id: string;
  createdAt: string;
  duration: number;
  audioBlob?: Blob;
  audioUrl?: string;
  waveformData?: number[];
  status: VoiceRecordingStatus;
  error?: string;
}

export interface TranscriptionSegment {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
  confidence: number;
  speaker?: string;
  language?: string;
}

export interface Transcription {
  id: string;
  recordingId: string;
  fullText: string;
  segments: TranscriptionSegment[];
  language: string;
  confidence: number;
  wordCount: number;
  processingTimeMs: number;
  provider: TranscriptionProvider;
  createdAt: string;
}

// Borjie role taxonomy (replaces FinLit's borrower / officer / admin)
export type BorjieVoiceRole =
  | 'owner'
  | 'manager'
  | 'employee'
  | 'buyer'
  | 'admin';

export interface VoiceNote {
  id: string;
  workflowId?: string;
  caseId?: string;
  userId: string;
  userRole: BorjieVoiceRole;
  recording: VoiceRecording;
  transcription?: Transcription;
  title?: string;
  tags: string[];
  context: VoiceNoteContext;
  analysis?: VoiceNoteAnalysis;
  createdAt: string;
  updatedAt: string;
}

export interface VoiceNoteContext {
  section?: string;
  step?: number;
  fieldId?: string;
  pageUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface VoiceNoteAnalysis {
  sentiment: 'positive' | 'neutral' | 'negative' | 'mixed';
  keyPoints: string[];
  suggestedActions: string[];
  extractedData?: Record<string, unknown>;
  confidence: number;
}

// Voice command types for navigation/actions
export interface VoiceCommand {
  phrase: string;
  aliases: string[];
  action: string;
  parameters?: Record<string, string>;
}

export interface VoiceCommandResult {
  matched: boolean;
  command?: VoiceCommand;
  confidence: number;
  rawText: string;
}

// Events
export interface VoiceRecorderEvents {
  onStart: () => void;
  onStop: (recording: VoiceRecording) => void;
  onPause: () => void;
  onResume: () => void;
  onError: (error: Error) => void;
  onVolumeChange: (volume: number) => void;
  onTranscriptionProgress: (text: string) => void;
  onTranscriptionComplete: (transcription: Transcription) => void;
}

// Form field voice input
export interface VoiceFieldInput {
  fieldId: string;
  fieldLabel: string;
  currentValue: string;
  voiceInput: string;
  suggestedValue: string;
  confidence: number;
  requiresReview: boolean;
}

// Site visit voice notes (mining-domain analogue of LitFin site visits)
export interface SiteVisitVoiceNote extends VoiceNote {
  location?: {
    latitude: number;
    longitude: number;
    address?: string;
  };
  photos?: string[];
  observations: string[];
  concerns: string[];
  recommendations: string[];
}

// Interview/meeting transcription
export interface InterviewTranscription {
  id: string;
  workflowId: string;
  participants: {
    id: string;
    name: string;
    role: string;
  }[];
  recording: VoiceRecording;
  transcription: Transcription;
  summary?: string;
  keyDiscussionPoints: string[];
  actionItems: string[];
  createdAt: string;
}

// Hotword detection (wake-word for hands-free mining workforce)
export interface HotwordDetectorConfig {
  readonly hotword: string;
  readonly sensitivity: number; // 0-1
  readonly silenceTimeoutMs: number;
  readonly language: string;
}

export interface HotwordEvent {
  readonly detected: boolean;
  readonly confidence: number;
  readonly timestamp: number;
  readonly transcript?: string;
}
