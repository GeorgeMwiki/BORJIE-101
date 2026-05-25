/**
 * Voice-bridge tests.
 *
 * Covers:
 *   - applyVoiceProfile augments toneGuidance and attaches a voice
 *     section.
 *   - The base PersonaIdentity is never mutated (immutability).
 *   - personaWithVoice routes the right voice for each surface.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  applyVoiceProfile,
  personaWithVoice,
  setVoiceProfileResolver,
  SURFACE_DEFAULT_VOICE,
  TENANT_RESIDENT_PERSONA,
  type VoiceProfile,
  type VoiceProfileResolver,
  type ThoughtRequest,
} from '../kernel/index.js';
import type { ScopeContext } from '../types.js';

// ─────────────────────────────────────────────────────────────────────
// Fixtures — inline VoiceProfile values that match the duck-typed
// shape exported by the bridge. These mirror the real profiles in
// voice-persona-dna closely enough that the bridge logic is exercised
// realistically without us having to import that package.
// ─────────────────────────────────────────────────────────────────────

const TENANT_VOICE: VoiceProfile = {
  personaId: 'mr-mwikila-tenant',
  displayName: 'Tenant-facing voice',
  tone: 'warm',
  pace: { wordsPerMinute: 170, pausesAfterSentence: 'short' },
  vocabularyRegister: 'conversational',
  codeSwitching: {
    primary: 'en-KE',
    allowedInserts: ['sw-KE', 'sw-TZ'],
    triggerContexts: ['greeting', 'rapport', 'reassurance', 'closing'],
  },
  greetingPatterns: ['Hi!', 'Hello!', 'Habari yako!'],
  closingPatterns: ['Take care.', 'Thanks!', 'Asante sana.'],
  taboos: ['that\'s not my problem', 'pay up', 'whatever', 'read the lease', 'don\'t bother me'],
};

const HEAD_VOICE: VoiceProfile = {
  personaId: 'mr-mwikila-head',
  displayName: 'Head-of-Estates voice',
  tone: 'formal',
  pace: { wordsPerMinute: 155, pausesAfterSentence: 'medium' },
  vocabularyRegister: 'professional',
  codeSwitching: {
    primary: 'en-KE',
    allowedInserts: ['sw-KE'],
    triggerContexts: ['greeting'],
  },
  greetingPatterns: ['Good morning.', 'Good afternoon.', 'Habari ya asubuhi.'],
  closingPatterns: ['Awaiting direction.', 'On file.', 'Asante.'],
  taboos: ['no worries', 'gonna', 'kinda', 'lol', 'maybe idk'],
};

const REGULATOR_VOICE: VoiceProfile = {
  personaId: 'mr-mwikila-regulator',
  displayName: 'Regulator-facing voice',
  tone: 'formal',
  pace: { wordsPerMinute: 145, pausesAfterSentence: 'long' },
  vocabularyRegister: 'literary',
  greetingPatterns: ['To Whom It May Concern,', 'Dear Sir or Madam,', 'Dear Commissioner,'],
  closingPatterns: ['Yours faithfully,', 'Respectfully submitted,', 'Sincerely,'],
  taboos: ['hey', 'hi there', 'gonna', 'kinda', 'no biggie'],
};

const OWNER_VOICE: VoiceProfile = {
  personaId: 'mr-mwikila-owner',
  displayName: 'Owner-liaison voice',
  tone: 'warm',
  pace: { wordsPerMinute: 160, pausesAfterSentence: 'medium' },
  vocabularyRegister: 'professional',
  greetingPatterns: ['Hello.', 'Hi.', 'Habari.'],
  closingPatterns: ['Talk soon.', 'Thanks.', 'Asante.'],
  taboos: ['gonna', 'wanna', 'cheap', 'trust me', 'don\'t worry'],
};

const APPLICANT_VOICE: VoiceProfile = {
  personaId: 'mr-mwikila-applicant',
  displayName: 'Applicant-facing voice',
  tone: 'warm',
  pace: { wordsPerMinute: 165, pausesAfterSentence: 'medium' },
  vocabularyRegister: 'conversational',
  greetingPatterns: ['Hi.', 'Hello.', 'Habari yako.'],
  closingPatterns: ['Reply here.', 'Soon.', 'Asante.'],
  taboos: ['you must', 'hurry up', 'last chance', 'don\'t miss out', 'limited time'],
};

const FIXTURE_BY_ID: Record<string, VoiceProfile> = {
  'mr-mwikila-tenant': TENANT_VOICE,
  'mr-mwikila-head': HEAD_VOICE,
  'mr-mwikila-regulator': REGULATOR_VOICE,
  'mr-mwikila-owner': OWNER_VOICE,
  'mr-mwikila-applicant': APPLICANT_VOICE,
};

const stubResolver: VoiceProfileResolver = (id) => FIXTURE_BY_ID[id] ?? null;

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

const TENANT_SCOPE: ScopeContext = {
  kind: 'tenant',
  tenantId: 't',
  actorUserId: 'u',
  roles: ['tenant'],
  personaId: 'tenant-resident',
};

function makeReq(surface: ThoughtRequest['surface']): ThoughtRequest {
  return {
    threadId: 'th',
    userMessage: 'hello',
    scope: TENANT_SCOPE,
    tier: 'tenant',
    stakes: 'low',
    surface,
  };
}

let previousResolver: VoiceProfileResolver;

beforeEach(() => {
  previousResolver = setVoiceProfileResolver(stubResolver);
});

afterEach(() => {
  setVoiceProfileResolver(previousResolver);
});

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe('applyVoiceProfile', () => {
  it('returns a new persona with toneGuidance augmented by the voice description', () => {
    const voiced = applyVoiceProfile(TENANT_RESIDENT_PERSONA, TENANT_VOICE);

    // Original kernel toneGuidance is preserved as a prefix.
    expect(voiced.toneGuidance.startsWith(TENANT_RESIDENT_PERSONA.toneGuidance)).toBe(true);
    // Voice profile description is appended.
    expect(voiced.toneGuidance).toContain('Tenant-facing voice');
    expect(voiced.toneGuidance).toContain('warm');
    expect(voiced.toneGuidance).toContain('conversational');
    expect(voiced.toneGuidance).toContain('170wpm');
    expect(voiced.toneGuidance).toContain('en-KE');

    // Voice section is attached.
    expect(voiced.voice.profileId).toBe('mr-mwikila-tenant');
    expect(voiced.voice.tone).toBe('warm');
    expect(voiced.voice.primaryLocale).toBe('en-KE');
    expect(voiced.voice.allowedLocaleInserts).toEqual(['sw-KE', 'sw-TZ']);
    expect(voiced.voice.greetingPatterns.length).toBeGreaterThanOrEqual(3);
    expect(voiced.voice.voiceTaboos).toContain('whatever');

    // Identity fields unchanged.
    expect(voiced.id).toBe(TENANT_RESIDENT_PERSONA.id);
    expect(voiced.firstPersonNoun).toBe(TENANT_RESIDENT_PERSONA.firstPersonNoun);
    expect(voiced.openingStatement).toBe(TENANT_RESIDENT_PERSONA.openingStatement);
  });
});

describe('applyVoiceProfile — immutability', () => {
  it('does not mutate the base persona', () => {
    // Snapshot the relevant fields.
    const beforeTone = TENANT_RESIDENT_PERSONA.toneGuidance;
    const beforeOpening = TENANT_RESIDENT_PERSONA.openingStatement;
    const beforeId = TENANT_RESIDENT_PERSONA.id;
    const beforeTaboos = TENANT_RESIDENT_PERSONA.taboos.slice();
    const beforeSignals = TENANT_RESIDENT_PERSONA.violationSignals.slice();
    const beforeNoun = TENANT_RESIDENT_PERSONA.firstPersonNoun;

    const voiced = applyVoiceProfile(TENANT_RESIDENT_PERSONA, TENANT_VOICE);

    // Returned persona is a NEW object reference.
    expect(voiced).not.toBe(TENANT_RESIDENT_PERSONA);

    // Base persona is unchanged across every field after the call.
    expect(TENANT_RESIDENT_PERSONA.toneGuidance).toBe(beforeTone);
    expect(TENANT_RESIDENT_PERSONA.openingStatement).toBe(beforeOpening);
    expect(TENANT_RESIDENT_PERSONA.id).toBe(beforeId);
    expect(TENANT_RESIDENT_PERSONA.firstPersonNoun).toBe(beforeNoun);
    expect(TENANT_RESIDENT_PERSONA.taboos).toEqual(beforeTaboos);
    expect(TENANT_RESIDENT_PERSONA.violationSignals).toEqual(beforeSignals);

    // Base persona has no `voice` field bolted on.
    expect((TENANT_RESIDENT_PERSONA as unknown as { voice?: unknown }).voice).toBeUndefined();
  });
});

describe('personaWithVoice — surface routing', () => {
  it('routes the right voice for each surface via SURFACE_DEFAULT_VOICE', () => {
    const cases: ReadonlyArray<{
      surface: ThoughtRequest['surface'];
      expectedProfile: string;
    }> = [
      { surface: 'tenant-app', expectedProfile: 'mr-mwikila-tenant' },
      { surface: 'owner-portal', expectedProfile: 'mr-mwikila-owner' },
      { surface: 'estate-manager-app', expectedProfile: 'mr-mwikila-head' },
      { surface: 'admin-portal', expectedProfile: 'mr-mwikila-head' },
      { surface: 'platform-hq', expectedProfile: 'mr-mwikila-regulator' },
      { surface: 'classroom', expectedProfile: 'mr-mwikila-applicant' },
      { surface: 'marketing', expectedProfile: 'mr-mwikila-applicant' },
    ];

    for (const { surface, expectedProfile } of cases) {
      // The static map is the contract.
      expect(SURFACE_DEFAULT_VOICE[surface]).toBe(expectedProfile);

      // personaWithVoice resolves through the active resolver.
      const result = personaWithVoice(makeReq(surface));
      expect(result.voice.profileId).toBe(expectedProfile);
      // Voice section's display name comes from the profile, not the
      // base persona.
      expect(result.voice.displayName).toBe(FIXTURE_BY_ID[expectedProfile]!.displayName);
    }
  });
});
