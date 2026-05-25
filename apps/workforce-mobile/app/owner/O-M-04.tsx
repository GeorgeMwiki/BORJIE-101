import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { RoleGuard } from '../../src/components/RoleGuard'

const SCREEN_ID = 'O-M-04'

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Ramani" hint="Polygons + rangi za hali">
          <PlaceholderList items={[{ id: 'map', primary: '— ramani ya migodi —' }]} />
        </Section>
        <Section title="Migodi yote">
          <PlaceholderList
            items={[
              { id: 's1', primary: 'PML 12345 · hai', secondary: 'Geita' },
              { id: 's2', primary: 'PML 67890 · subiri', secondary: 'Chunya' },
              { id: 's3', primary: 'PML 24680 · kazi', secondary: 'Mwanza' }
            ]}
          />
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}
