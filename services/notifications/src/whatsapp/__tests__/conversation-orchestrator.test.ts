/**
 * Conversation orchestrator — confirmation-summary refusal test.
 *
 * The previous behaviour silently substituted the literal `'TBD'` when
 * `ctx.moveInDate` was missing, shipping misleading copy to residents.
 * We now throw a `TemplateContextIncomplete` error so the state
 * machine can backfill before retrying.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  ConversationOrchestrator,
  InMemorySessionStore,
  TemplateContextIncomplete,
  type TenantInfo,
  type TenantLookup,
} from '../conversation-orchestrator.js';
import type { ConversationSession } from '../types.js';

function makeSession(overrides: Partial<ConversationSession> = {}): ConversationSession {
  const base: ConversationSession = {
    id: 'sess_1',
    phoneNumber: '+255712345678',
    tenantId: 'tenant_1',
    state: 'onboarding_emergency_contact',
    language: 'en',
    context: {
      onboarding: {
        step: 5,
        completedSteps: ['language', 'moveIn', 'occupants', 'emergencyContact'],
        moveInDate: undefined as unknown as string,
        numberOfOccupants: 2,
        emergencyContactName: 'Jane',
        emergencyContactPhone: '+255712000000',
      },
    } as ConversationSession['context'],
    messageHistory: [],
    expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  return { ...base, ...overrides };
}

function makeOrchestrator(): {
  orchestrator: ConversationOrchestrator;
  sendText: ReturnType<typeof vi.fn>;
} {
  const sendText = vi.fn(async () => undefined);
  const sendButtons = vi.fn(async () => undefined);
  const sessionStore = new InMemorySessionStore();
  const tenantLookup: TenantLookup = {
    async findByPhone() {
      return null;
    },
    async findById(): Promise<TenantInfo | null> {
      return {
        tenantId: 'tenant_1',
        name: 'Resident One',
        phoneNumber: '+255712345678',
        propertyId: 'prop_1',
        propertyName: 'Test Property',
        unitId: 'unit_1',
        unitNumber: 'A-1',
        onboardingStatus: 'in_progress',
      };
    },
    async updateOnboardingStatus() {
      return undefined;
    },
  };
  const whatsappClient = {
    sendText,
    sendButtons,
  } as unknown as ConstructorParameters<typeof ConversationOrchestrator>[0]['whatsappClient'];
  const orchestrator = new ConversationOrchestrator({
    whatsappClient,
    sessionStore,
    tenantLookup,
  });
  return { orchestrator, sendText };
}

describe('ConversationOrchestrator.showOnboardingConfirmation', () => {
  it('throws TemplateContextIncomplete when moveInDate is missing', async () => {
    const { orchestrator, sendText } = makeOrchestrator();
    const session = makeSession();
    // Access the private method via an as any cast — the public surface
    // routes here through the state machine, but the contract under
    // test is the missing-field refusal.
    await expect(
      (orchestrator as unknown as { showOnboardingConfirmation: (s: ConversationSession) => Promise<void> })
        .showOnboardingConfirmation(session),
    ).rejects.toBeInstanceOf(TemplateContextIncomplete);
    expect(sendText).not.toHaveBeenCalled();
  });

  it('renders the confirmation when moveInDate is present', async () => {
    const { orchestrator, sendText } = makeOrchestrator();
    const session = makeSession({
      context: {
        onboarding: {
          step: 5,
          completedSteps: ['language', 'moveIn', 'occupants', 'emergencyContact'],
          moveInDate: '15/03/2026',
          numberOfOccupants: 2,
          emergencyContactName: 'Jane',
          emergencyContactPhone: '+255712000000',
        },
      } as ConversationSession['context'],
    });
    await (orchestrator as unknown as { showOnboardingConfirmation: (s: ConversationSession) => Promise<void> })
      .showOnboardingConfirmation(session);
    expect(sendText).toHaveBeenCalledOnce();
    const [arg] = sendText.mock.calls[0]!;
    expect(arg.text).toContain('15/03/2026');
  });
});
