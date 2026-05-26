/**
 * PersonaHeader — canonical display lock.
 *
 * The user-facing identity is locked to `MR_MWIKILA_CANONICAL_DISPLAY`.
 * Whatever specialisation the audience resolver chose internally
 * (safety-junior, marketplace-junior, estate-ops-junior, …) must never
 * leak into the rendered header. See:
 *   - Docs/DESIGN/CAPABILITIES_UNIFICATION.md "User-facing identity is locked"
 *   - packages/chat-ui/src/canonical-display.ts
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PersonaHeader } from '../PersonaHeader.js';
import { MR_MWIKILA_CANONICAL_DISPLAY } from '../../canonical-display.js';
import type { ResolvedAgent } from '../types.js';

const LEAKY_SPECIALISATIONS: ReadonlyArray<ResolvedAgent> = [
  {
    id: 'safety-junior',
    display_name: 'Safety Officer',
    title: 'Workforce Junior',
    surface: 'workforce-mobile',
  },
  {
    id: 'marketplace-junior',
    display_name: 'Marketplace Concierge',
    title: 'Buyer Junior',
    surface: 'buyer-mobile',
  },
  {
    id: 'estate-ops-junior',
    display_name: 'Estate Operations',
    title: 'Site Junior',
    surface: 'borjie-estate-manager-app',
  },
  {
    id: 'tenant-junior',
    display_name: 'Tenancy Concierge',
    title: 'Customer Junior',
    surface: 'borjie-customer-app',
  },
];

const SPECIALISATION_LEAK_SIGNALS: ReadonlyArray<string> = [
  'Specialist',
  'Advisor',
  'Officer',
  'Concierge',
  'Junior',
  'subtitle',
];

describe('PersonaHeader — canonical display lock', () => {
  afterEach(() => {
    cleanup();
  });

  it('always renders MR_MWIKILA_CANONICAL_DISPLAY.name + .title', () => {
    render(
      <PersonaHeader
        agent={{
          id: 'mr-mwikila-full',
          display_name: 'Mr. Mwikila',
          title: 'Managing Director',
          surface: 'owner-web',
        }}
        enable_dashboard_link={false}
      />,
    );
    const header = screen.getByTestId('home-persona-header');
    expect(header.textContent ?? '').toContain(MR_MWIKILA_CANONICAL_DISPLAY.name);
    expect(header.textContent ?? '').toContain(MR_MWIKILA_CANONICAL_DISPLAY.title);
  });

  it.each(LEAKY_SPECIALISATIONS)(
    'never leaks specialisation $id into the rendered header',
    (agent) => {
      render(<PersonaHeader agent={agent} enable_dashboard_link={false} />);
      const header = screen.getByTestId('home-persona-header');
      const text = header.textContent ?? '';
      // The locked canonical identity is present.
      expect(text).toContain(MR_MWIKILA_CANONICAL_DISPLAY.name);
      expect(text).toContain(MR_MWIKILA_CANONICAL_DISPLAY.title);
      // The internal specialisation strings never leak through.
      for (const signal of SPECIALISATION_LEAK_SIGNALS) {
        expect(text).not.toContain(signal);
      }
    },
  );
});
