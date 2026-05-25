import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { AskBorjie } from '../../src/components/AskBorjie'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { RoleGuard } from '../../src/components/RoleGuard'

const SCREEN_ID = 'O-M-08'

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Uliza hati zako">
          <AskBorjie label="Uliza Hati" />
        </Section>
        <Section title="Hati za hivi karibuni">
          <PlaceholderList
            items={[
              { id: 'doc1', primary: 'PML renewal letter.pdf' },
              { id: 'doc2', primary: 'Geita assay 2026-05.pdf' }
            ]}
          />
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}
