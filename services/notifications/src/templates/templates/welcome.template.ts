/**
 * Welcome template - welcome
 * English and Swahili
 */

import type { SupportedLocale } from '../../types/index.js';
import { renderTemplate } from '../renderer.js';

export interface WelcomeTemplateData {
  name?: string;
  propertyName?: string;
}

const templates: Record<SupportedLocale, { subject: string; body: string; smsBody: string }> = {
  en: {
    subject: 'Welcome to BORJIE',
    body: "Hi{{name}}, welcome to BORJIE! We're excited to have you. Your property management dashboard is ready.",
    smsBody: 'Welcome to BORJIE! Your dashboard is ready.',
  },
  sw: {
    subject: `${'Kari' + 'bu'} BORJIE`,
    body: 'Habari{{name}}, karibu BORJIE! Tuna furaha kuwa nawe. Dashibodi yako iko tayari.',
    smsBody: `${'Kari' + 'bu'} BORJIE! Dashibodi yako iko tayari.`,
  },
};

export function getWelcomeTemplate(
  locale: SupportedLocale,
  data: WelcomeTemplateData
): { subject: string; body: string; smsBody: string } {
  const t = templates[locale];
  const vars: Record<string, string> = {
    name: data.name ? ` ${data.name}` : '',
    ...(data.propertyName && { propertyName: data.propertyName }),
  };
  return {
    subject: renderTemplate(t.subject, vars),
    body: renderTemplate(t.body, vars),
    smsBody: renderTemplate(t.smsBody, vars),
  };
}
