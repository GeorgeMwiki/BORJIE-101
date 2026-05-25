/**
 * Proactive intervention delivery pipeline
 *
 * Takes interventions produced by BehaviorObserver, applies user preferences
 * (quiet mode, language, intensity), and packages them for the chat-ui layer.
 *
 * This layer is deliberately thin \u2014 the heavy behavioural logic lives in
 * BehaviorObserver. This file is concerned with *whether to deliver* and
 * *how to frame* the intervention for the UI.
 */

import type { ProactiveIntervention } from './types.js';

export interface InterventionPreferences {
  readonly language: 'en' | 'sw';
  readonly quietMode: boolean;
  readonly intensity: 'minimal' | 'moderate' | 'proactive';
  readonly enableCelebrations: boolean;
  readonly enableTips: boolean;
}

export const DEFAULT_PREFERENCES: InterventionPreferences = {
  language: 'en',
  quietMode: false,
  intensity: 'moderate',
  enableCelebrations: true,
  enableTips: true,
};

export interface DeliveredIntervention {
  readonly intervention: ProactiveIntervention;
  readonly displayMessage: string;
  readonly preferredSurface: 'bubble' | 'inline' | 'toast';
}

export class ProactiveInterventionEngine {
  private readonly preferences = new Map<string, InterventionPreferences>();

  setPreferences(
    tenantId: string,
    userId: string,
    prefs: Partial<InterventionPreferences>,
  ): void {
    const key = this.key(tenantId, userId);
    const existing = this.preferences.get(key) ?? DEFAULT_PREFERENCES;
    this.preferences.set(key, { ...existing, ...prefs });
  }

  getPreferences(
    tenantId: string,
    userId: string,
  ): InterventionPreferences {
    return this.preferences.get(this.key(tenantId, userId)) ?? DEFAULT_PREFERENCES;
  }

  /** Decide whether & how to deliver an intervention. Returns null to drop. */
  deliver(
    intervention: ProactiveIntervention,
  ): DeliveredIntervention | null {
    const prefs = this.getPreferences(
      intervention.tenantId,
      intervention.userId,
    );

    if (prefs.quietMode) return null;

    if (!prefs.enableCelebrations && intervention.type === 'celebrate_progress') {
      return null;
    }
    if (!prefs.enableTips && intervention.type === 'provide_tip') {
      return null;
    }

    if (prefs.intensity === 'minimal' && intervention.priority === 'low') {
      return null;
    }

    const displayMessage =
      prefs.language === 'sw' && intervention.messageSwahili
        ? intervention.messageSwahili
        : intervention.message;

    return {
      intervention,
      displayMessage,
      preferredSurface: pickSurface(intervention),
    };
  }

  private key(tenantId: string, userId: string): string {
    return `${tenantId}::${userId}`;
  }
}

function pickSurface(
  i: ProactiveIntervention,
): DeliveredIntervention['preferredSurface'] {
  if (i.type === 'celebrate_progress') return 'toast';
  if (i.type === 'confirm_action' || i.type === 'recommend_review') {
    return 'inline';
  }
  return 'bubble';
}
