import { StyleSheet, View } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { PhotoSlot } from '../../src/components/StubBlocks'
import { RoleGuard } from '../../src/components/RoleGuard'
import { spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'W-M-07'

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Drill hole">
          <PlaceholderList
            items={[
              { id: 'id', primary: 'Hole ID', secondary: 'DH-2026-0184' },
              { id: 'gps', primary: 'GPS', secondary: '-3.4287, 32.9183' },
              { id: 'kind', primary: 'Aina', secondary: 'Diamond core' }
            ]}
          />
        </Section>
        <Section title="Picha">
          <View style={styles.row}>
            <PhotoSlot label="Picha 1" />
            <PhotoSlot label="Picha 2" />
          </View>
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm }
})
