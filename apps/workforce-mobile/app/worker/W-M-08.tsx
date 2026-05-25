import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { PhotoSlot } from '../../src/components/StubBlocks'
import { RoleGuard } from '../../src/components/RoleGuard'

const SCREEN_ID = 'W-M-08'

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Sampuli">
          <PlaceholderList
            items={[
              { id: 't', primary: 'Tag', secondary: 'SMP-0421' },
              { id: 'w', primary: 'Uzito', secondary: '4.2 kg' },
              { id: 'c', primary: 'Mlolongo', secondary: 'Foreman -> Lab van' }
            ]}
          />
        </Section>
        <Section title="Picha">
          <PhotoSlot label="Picha ya tag" />
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}
