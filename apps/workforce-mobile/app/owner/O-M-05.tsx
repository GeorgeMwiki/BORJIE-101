import { View, StyleSheet } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { PhotoSlot } from '../../src/components/StubBlocks'
import { RoleGuard } from '../../src/components/RoleGuard'
import { spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'O-M-05'

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Shifti ya hivi karibuni">
          <PlaceholderList
            items={[
              { id: 'sh', primary: 'Shifti A · 06:00-18:00', secondary: 'Watu 24 · loads 18' }
            ]}
          />
        </Section>
        <Section title="Picha za leo">
          <View style={styles.row}>
            <PhotoSlot label="Picha 1" />
            <PhotoSlot label="Picha 2" />
            <PhotoSlot label="Picha 3" />
          </View>
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.sm
  }
})
