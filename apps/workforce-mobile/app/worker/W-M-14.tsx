import { StyleSheet, View } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { PhotoSlot } from '../../src/components/StubBlocks'
import { AskBorjie } from '../../src/components/AskBorjie'
import { RoleGuard } from '../../src/components/RoleGuard'
import { spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'W-M-14'

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Tukio">
          <PlaceholderList
            items={[
              { id: 'k', primary: 'Aina', secondary: 'Near-miss' },
              { id: 's', primary: 'Ukali', secondary: 'Wastani' }
            ]}
          />
        </Section>
        <Section title="Picha">
          <View style={styles.row}>
            <PhotoSlot label="Picha 1" />
            <PhotoSlot label="Picha 2" />
          </View>
        </Section>
        <Section title="Sauti">
          <AskBorjie label="Rekodi maelezo" />
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm }
})
