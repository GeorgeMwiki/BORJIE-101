import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { RoleGuard } from '../../src/components/RoleGuard'

const SCREEN_ID = 'O-M-12'

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Idadi kwa mgodi">
          <PlaceholderList
            items={[
              { id: 'g', primary: 'Geita · 24', secondary: 'Permanent 18 · casual 6' },
              { id: 'c', primary: 'Chunya · 12', secondary: 'Permanent 8 · casual 4' },
              { id: 'm', primary: 'Mwanza · 9', secondary: 'Permanent 5 · casual 4' }
            ]}
          />
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}
