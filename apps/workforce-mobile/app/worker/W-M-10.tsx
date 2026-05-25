import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { RoleGuard } from '../../src/components/RoleGuard'

const SCREEN_ID = 'W-M-10'

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Toa au rudisha">
          <PlaceholderList
            items={[
              { id: 'i', primary: 'Bidhaa', secondary: 'Helmet · qty 2' },
              { id: 'r', primary: 'Mpokeaji', secondary: 'Pit 2 crew' }
            ]}
          />
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}
