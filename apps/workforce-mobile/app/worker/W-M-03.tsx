import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { FingerprintPlaceholder } from '../../src/components/FingerprintPlaceholder'
import { RoleGuard } from '../../src/components/RoleGuard'

const SCREEN_ID = 'W-M-03'

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Maelezo ya leo">
          <PlaceholderList
            items={[
              { id: 't1', primary: 'Hatari ya leo: pit slope south', secondary: 'Kaa mbali na crest' },
              { id: 't2', primary: 'PPE: helmet + boots + vest' }
            ]}
          />
        </Section>
        <Section title="Thibitisho">
          <FingerprintPlaceholder label="Nimesoma" />
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}
