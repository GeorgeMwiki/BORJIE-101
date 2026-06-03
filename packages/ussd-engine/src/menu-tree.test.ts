import { describe, it, expect } from 'vitest';
import {
  buildMainMenu,
  buildMenuTree,
  buildLicenceScreen,
  buildRoyaltyScreen,
  buildProductionLogConfirm,
  buildMarketplaceScreen,
  buildLanguageMenu,
  buildErrorScreen,
  truncateToUssd,
  tierSatisfies,
} from './menu-tree.js';
import { USSD_MAX_CHARS } from './types.js';

describe('truncateToUssd', () => {
  it('passes short text through unchanged', () => {
    expect(truncateToUssd('hello')).toBe('hello');
  });

  it('clamps to the screen budget with an ellipsis', () => {
    const long = 'x'.repeat(300);
    const out = truncateToUssd(long);
    expect(out.length).toBe(USSD_MAX_CHARS);
    expect(out.endsWith('...')).toBe(true);
  });
});

describe('tierSatisfies', () => {
  it('owner satisfies every required tier', () => {
    expect(tierSatisfies('owner', 'employee')).toBe(true);
    expect(tierSatisfies('owner', 'manager')).toBe(true);
    expect(tierSatisfies('owner', 'anonymous')).toBe(true);
  });

  it('anonymous only satisfies anonymous', () => {
    expect(tierSatisfies('anonymous', 'anonymous')).toBe(true);
    expect(tierSatisfies('anonymous', 'employee')).toBe(false);
  });

  it('employee does not satisfy manager-only', () => {
    expect(tierSatisfies('employee', 'manager')).toBe(false);
  });
});

describe('buildMainMenu tier filtering', () => {
  it('shows only the market + language to an anonymous caller', () => {
    const menu = buildMainMenu('en', 'anonymous');
    expect(menu).toContain('Market Prices');
    expect(menu).toContain('Language');
    expect(menu).not.toContain('My Licence');
    expect(menu).not.toContain('Royalty Due');
  });

  it('shows licence/log/payout to an employee but hides royalty', () => {
    const menu = buildMainMenu('en', 'employee');
    expect(menu).toContain('My Licence');
    expect(menu).toContain('Log Output');
    expect(menu).toContain('Payout Status');
    expect(menu).not.toContain('Royalty Due');
  });

  it('shows everything to an owner', () => {
    const menu = buildMainMenu('en', 'owner');
    expect(menu).toContain('My Licence');
    expect(menu).toContain('Royalty Due');
    expect(menu).toContain('Log Output');
    expect(menu).toContain('Market Prices');
  });

  it('keeps option keys stable when an option is hidden', () => {
    // Employee cannot see royalty (key 2) but log-output keeps key 3.
    const menu = buildMainMenu('en', 'employee');
    expect(menu).toContain('3. Log Output');
    expect(menu).toContain('1. My Licence');
  });
});

describe('single-language guarantee (zero-mix)', () => {
  it('renders the Swahili main menu with no English option labels', () => {
    const menu = buildMainMenu('sw', 'owner');
    expect(menu).toContain('Leseni Yangu');
    expect(menu).toContain('Mrabaha');
    expect(menu).not.toContain('My Licence');
    expect(menu).not.toContain('Royalty Due');
  });

  it('renders an English error with no Swahili', () => {
    const screen = buildErrorScreen('invalid', 'en');
    expect(screen).toBe('Invalid choice. Try again.');
    expect(screen).not.toMatch(/batili/);
  });
});

describe('dynamic screens', () => {
  it('renders a licence screen', () => {
    const screen = buildLicenceScreen(
      {
        licenceRef: 'PML-00421',
        statusEn: 'Active',
        statusSw: 'Hai',
        expiresOn: '2027-01-15',
        daysToExpiry: 590,
      },
      'en',
    );
    expect(screen).toContain('PML-00421');
    expect(screen).toContain('Active');
    expect(screen).toContain('590 days left');
  });

  it('renders a royalty screen with rendered currency strings', () => {
    const screen = buildRoyaltyScreen(
      {
        periodLabel: 'May 2026',
        amountDueDisplay: 'TZS 1,200,000',
        amountPaidDisplay: 'TZS 0',
        nextActionEn: 'Pay before 30th',
        nextActionSw: 'Lipa kabla ya 30',
      },
      'en',
    );
    expect(screen).toContain('TZS 1,200,000');
    expect(screen).toContain('Pay before 30th');
  });

  it('renders a production-log confirmation', () => {
    const screen = buildProductionLogConfirm(45, 'sw');
    expect(screen).toContain('45g');
    expect(screen).toContain('Ndiyo');
    expect(screen).toContain('Hapana');
  });

  it('renders a marketplace list and an empty state', () => {
    const filled = buildMarketplaceScreen(
      [
        { mineralEn: 'Gold', mineralSw: 'Dhahabu', priceDisplay: 'TZS 150k/g' },
        { mineralEn: 'Tanzanite', mineralSw: 'Tanzanite', priceDisplay: 'TZS 90k/ct' },
      ],
      'en',
    );
    expect(filled).toContain('1. Gold TZS 150k/g');
    expect(filled).toContain('2. Tanzanite');

    const empty = buildMarketplaceScreen([], 'en');
    expect(empty).toContain('No prices available');
  });
});

describe('buildMenuTree', () => {
  it('exposes a root and dynamic leaf nodes', () => {
    const tree = buildMenuTree();
    expect(tree.root.id).toBe('main_menu');
    expect(tree.nodes.licence?.isDynamic).toBe(true);
    expect(tree.nodes.royalty?.isDynamic).toBe(true);
    expect(tree.nodes.language_switch?.options).toHaveLength(2);
  });
});

describe('buildLanguageMenu', () => {
  it('is the one bilingual screen (no language set yet)', () => {
    const menu = buildLanguageMenu();
    expect(menu).toContain('English');
    expect(menu).toContain('Kiswahili');
  });
});
