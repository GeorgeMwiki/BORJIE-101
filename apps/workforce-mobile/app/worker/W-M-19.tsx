import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { BigNumber } from '../../src/components/StubBlocks'
import { RoleGuard } from '../../src/components/RoleGuard'

const SCREEN_ID = 'W-M-19'

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Hudhuria">
          <BigNumber value="06:02" label="Umesha-ingia" caption="Geita · pit 2 fence" />
        </Section>
        <Section title="Historia ya wiki">
          <PlaceholderList
            items={[
              { id: 'd1', primary: 'Jumatatu', secondary: 'IN 06:01 · OUT 18:04' },
              { id: 'd2', primary: 'Jumanne', secondary: 'IN 06:00 · OUT 18:02' }
            ]}
          />
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}
