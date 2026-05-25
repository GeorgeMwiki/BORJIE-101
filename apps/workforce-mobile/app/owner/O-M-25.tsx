import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { FingerprintPlaceholder } from '../../src/components/FingerprintPlaceholder'
import { RoleGuard } from '../../src/components/RoleGuard'

const SCREEN_ID = 'O-M-25'

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Vifaa kuingiza">
          <PlaceholderList
            items={[
              { id: 'a', primary: 'Maamuzi yote · Mei' },
              { id: 'b', primary: 'Hati za PML' },
              { id: 'c', primary: 'Ripoti za shifti' }
            ]}
          />
        </Section>
        <Section title="Saini ya kuondoa pakeji">
          <FingerprintPlaceholder label="Idhinisha kupakua" />
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}
