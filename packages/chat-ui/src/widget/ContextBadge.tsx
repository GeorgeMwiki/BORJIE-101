/**
 * ContextBadge — shows current portal + route + active sub-persona.
 *
 * Renders as a compact inline chip above the message list so users know
 * which "muscle" of Mr. Mwikila is currently flexed.
 */
import type { RouteContext, SubPersona } from './types';
import type { Language } from '../chat-modes/types';

interface ContextBadgeProps {
  readonly route: RouteContext;
  readonly language: Language;
}

const PERSONA_LABELS_EN: Record<SubPersona, string> = {
  finance: 'Finance',
  maintenance: 'Maintenance',
  leasing: 'Leasing',
  compliance: 'Compliance',
  learning: 'Training',
  advisor: 'Portfolio advisor',
  general: 'General',
};

const PERSONA_LABELS_SW: Record<SubPersona, string> = {
  finance: 'Fedha',
  maintenance: 'Matengenezo',
  leasing: 'Kukodisha',
  compliance: 'Uzingatiaji',
  learning: 'Mafunzo',
  advisor: 'Mshauri wa kwingineko',
  general: 'Jumla',
};

const PORTAL_LABELS_EN: Record<RouteContext['portal'], string> = {
  customer: 'Tenant app',
  'estate-manager': 'Manager app',
  admin: 'Admin portal',
  owner: 'Owner portal',
  public: 'Public site',
};

const PORTAL_LABELS_SW: Record<RouteContext['portal'], string> = {
  customer: 'Programu ya mpangaji',
  'estate-manager': 'Programu ya meneja',
  admin: 'Bandari ya msimamizi',
  owner: 'Bandari ya mmiliki',
  public: 'Tovuti ya umma',
};

export function ContextBadge({ route, language }: ContextBadgeProps): JSX.Element {
  const personaLabels = language === 'sw' ? PERSONA_LABELS_SW : PERSONA_LABELS_EN;
  const portalLabels = language === 'sw' ? PORTAL_LABELS_SW : PORTAL_LABELS_EN;

  return (
    <div
      data-testid="context-badge"
      data-sub-persona={route.activeSubPersona}
      data-portal={route.portal}
      style={{
        display: 'flex',
        gap: 6,
        alignItems: 'center',
        padding: '4px 10px',
        borderRadius: 999,
        background: '#eef2ff',
        color: '#3730a3',
        fontSize: 11,
        fontWeight: 500,
      }}
    >
      <span>{portalLabels[route.portal]}</span>
      <span aria-hidden="true">·</span>
      <span>{personaLabels[route.activeSubPersona]}</span>
      {route.entityMentions.length > 0 ? (
        <>
          <span aria-hidden="true">·</span>
          <span data-testid="context-badge-entity">{route.entityMentions[0]}</span>
        </>
      ) : null}
    </div>
  );
}
