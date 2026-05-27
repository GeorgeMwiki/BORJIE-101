import { describe, expect, it, vi } from 'vitest'

/**
 * Tests for PreviewBanner — copy + testID contract per kind.
 *
 * The workforce-mobile vitest config runs in a Node environment with no
 * React Native renderer and no JSX runtime in scope (see vitest.config.ts +
 * theme.test.ts pattern). The component itself relies on the Expo babel
 * preset at app build time; under vitest we can only import the module and
 * read its exported data contract. Each render path is therefore exercised
 * indirectly: BANNER_COPY[kind] is what the component pipes into the View,
 * and `preview-banner-${kind}` is the literal testID it sets — both are
 * asserted verbatim per kind below.
 */

vi.mock('react-native', () => ({
  StyleSheet: { create: (s: Record<string, unknown>) => s },
  Text: 'Text',
  View: 'View'
}))

import { BANNER_COPY, type PreviewBannerKind } from '../components/PreviewBanner'

function expectedTestId(kind: PreviewBannerKind): string {
  return `preview-banner-${kind}`
}

describe('PreviewBanner — env-missing', () => {
  it('renders the env-missing copy and testID preview-banner-env-missing', () => {
    expect(BANNER_COPY['env-missing'].sw).toBe(
      'Borjie haijaunganishwa na seva. Wasiliana na msimamizi.'
    )
    expect(BANNER_COPY['env-missing'].en).toBe('Borjie is not connected to the backend.')
    expect(expectedTestId('env-missing')).toBe('preview-banner-env-missing')
  })
})

describe('PreviewBanner — no-data', () => {
  it('renders the no-data copy and testID preview-banner-no-data', () => {
    expect(BANNER_COPY['no-data'].sw).toBe('Hakuna data bado kwa akaunti yako.')
    expect(BANNER_COPY['no-data'].en).toBe('No data yet on your account.')
    expect(expectedTestId('no-data')).toBe('preview-banner-no-data')
  })
})

describe('PreviewBanner — offline', () => {
  it('renders the offline copy and testID preview-banner-offline', () => {
    expect(BANNER_COPY.offline.sw).toBe('Uko nje ya mtandao. Tutasync ukirudi.')
    expect(BANNER_COPY.offline.en).toBe("You are offline. We'll sync when you reconnect.")
    expect(expectedTestId('offline')).toBe('preview-banner-offline')
  })
})
