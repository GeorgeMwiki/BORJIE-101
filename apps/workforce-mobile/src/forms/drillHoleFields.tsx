import { Controller, type Control, type UseFormSetValue } from 'react-hook-form'
import { Field } from './Field'
import { Dropdown } from './Dropdown'
import { Button } from './Button'
import { Section } from '../components/Section'
import type { DrillHoleForm, DrillKind } from './schemas/drillHole'

export interface DrillHoleFieldsProps {
  control: Control<DrillHoleForm>
  setValue: UseFormSetValue<DrillHoleForm>
  t: {
    common: { required: string }
    drillHole: {
      section: string
      holeId: string
      kind: string
      kindDiamond: string
      kindRc: string
      kindAuger: string
      depth: string
      sampleTagLabel: string
      sampleTagPlaceholder: string
      scanSampleTag: string
    }
  }
}

export function DrillHoleFields({ control, setValue, t }: DrillHoleFieldsProps): JSX.Element {
  return (
    <Section title={t.drillHole.section}>
      <Controller
        control={control}
        name="holeId"
        render={({ field, fieldState }) => (
          <Field
            label={t.drillHole.holeId}
            value={field.value}
            onChangeText={field.onChange}
            autoCapitalize="characters"
            error={fieldState.error ? t.common.required : null}
          />
        )}
      />
      <Controller
        control={control}
        name="kind"
        render={({ field }) => (
          <Dropdown<DrillKind>
            label={t.drillHole.kind}
            value={field.value}
            onChange={field.onChange}
            options={[
              { value: 'diamond', label: t.drillHole.kindDiamond },
              { value: 'rc', label: t.drillHole.kindRc },
              { value: 'auger', label: t.drillHole.kindAuger }
            ]}
          />
        )}
      />
      <Controller
        control={control}
        name="depth"
        render={({ field, fieldState }) => (
          <Field
            label={t.drillHole.depth}
            value={field.value}
            onChangeText={field.onChange}
            keyboardType="decimal-pad"
            error={fieldState.error ? t.common.required : null}
          />
        )}
      />
      <Controller
        control={control}
        name="sampleTag"
        render={({ field }) => (
          <Field
            label={t.drillHole.sampleTagLabel}
            value={field.value ?? ''}
            onChangeText={field.onChange}
            autoCapitalize="characters"
            placeholder={t.drillHole.sampleTagPlaceholder}
          />
        )}
      />
      <Button
        label={t.drillHole.scanSampleTag}
        variant="ghost"
        onPress={() => {
          // See gh-issue #14: requires EAS dev build — wire to
          // expo-barcode-scanner when the sample-tag scanner module
          // ships. For now we simulate a scan by generating a tag
          // prefix so QA can exercise the flow.
          const simulated = `SMP-${Date.now().toString().slice(-6)}`
          setValue('sampleTag', simulated, { shouldValidate: true })
        }}
      />
    </Section>
  )
}
