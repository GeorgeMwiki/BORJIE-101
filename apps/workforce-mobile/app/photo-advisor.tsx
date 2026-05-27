import { useCallback, useMemo, useState } from 'react'
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import * as Location from 'expo-location'

import { ScreenShell } from '../src/components/ScreenShell'
import { Section } from '../src/components/Section'
import { RoleGuard } from '../src/components/RoleGuard'
import { Button } from '../src/forms/Button'
import { useI18n } from '../src/i18n/useI18n'
import { colors } from '../src/theme/colors'
import { fontSize, radius, spacing } from '../src/theme/spacing'
import { usePhotoAdvisor } from '../src/photo-advisor/usePhotoAdvisor'
import {
  REQUIRED_BACKEND_CONTRACT,
  type PhotoAdvisorImage,
  type PhotoAdvisorLocation,
  type PhotoAdvisorResponse
} from '../src/photo-advisor/types'

const SCREEN_ID = 'photo-advisor'

type CaptureError = 'camera_denied' | 'capture_failed' | null

interface CapturedPhoto {
  uri: string
  base64: string
  width: number
  height: number
  mimeType: string
  capturedAt: number
}

function toAdvisorImage(p: CapturedPhoto): PhotoAdvisorImage {
  return {
    uri: p.uri,
    base64: p.base64,
    mimeType: p.mimeType,
    width: p.width,
    height: p.height,
    capturedAt: p.capturedAt
  }
}

export default function PhotoAdvisorScreen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <PhotoAdvisorBody />
      </ScreenShell>
    </RoleGuard>
  )
}

function PhotoAdvisorBody(): JSX.Element {
  const { t, lang } = useI18n()
  const copy = t.photoAdvisor

  const [photo, setPhoto] = useState<CapturedPhoto | null>(null)
  const [prompt, setPrompt] = useState<string>('')
  const [captureError, setCaptureError] = useState<CaptureError>(null)
  const [coords, setCoords] = useState<PhotoAdvisorLocation | null>(null)
  const [gpsState, setGpsState] = useState<'idle' | 'requesting' | 'granted' | 'denied'>('idle')

  const mutation = usePhotoAdvisor()

  const takePhoto = useCallback(async (): Promise<void> => {
    setCaptureError(null)
    const perm = await ImagePicker.getCameraPermissionsAsync()
    const granted = perm.granted
      ? true
      : (await ImagePicker.requestCameraPermissionsAsync()).granted
    if (!granted) {
      setCaptureError('camera_denied')
      return
    }
    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.6,
        base64: true,
        allowsEditing: false
      })
      if (result.canceled || result.assets.length === 0) {
        return
      }
      const asset = result.assets[0]
      if (!asset?.base64) {
        setCaptureError('capture_failed')
        return
      }
      setPhoto({
        uri: asset.uri,
        base64: asset.base64,
        mimeType: asset.mimeType ?? 'image/jpeg',
        width: asset.width,
        height: asset.height,
        capturedAt: Date.now()
      })
      // Best-effort GPS — never block capture on it.
      void requestLocation()
    } catch {
      setCaptureError('capture_failed')
    }
  }, [])

  const requestLocation = useCallback(async (): Promise<void> => {
    setGpsState('requesting')
    try {
      const perm = await Location.requestForegroundPermissionsAsync()
      if (perm.status !== 'granted') {
        setGpsState('denied')
        setCoords(null)
        return
      }
      const fix = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High
      })
      setCoords({
        latitude: fix.coords.latitude,
        longitude: fix.coords.longitude,
        accuracyMetres: fix.coords.accuracy ?? null,
        capturedAt: fix.timestamp
      })
      setGpsState('granted')
    } catch {
      setGpsState('denied')
      setCoords(null)
    }
  }, [])

  const submit = useCallback((): void => {
    if (!photo) {
      return
    }
    const image = toAdvisorImage(photo)
    mutation.mutate({
      uri: image.uri,
      base64: image.base64,
      mimeType: image.mimeType,
      width: image.width,
      height: image.height,
      prompt: prompt.trim().length > 0 ? prompt.trim() : null,
      location: coords,
      lang
    })
  }, [photo, prompt, coords, lang, mutation])

  const reset = useCallback((): void => {
    setPhoto(null)
    setPrompt('')
    setCoords(null)
    setGpsState('idle')
    setCaptureError(null)
    mutation.reset()
  }, [mutation])

  const errorCopy = useMemo(() => {
    const err = mutation.error
    if (!err) return null
    switch (err.code) {
      case 'UNAUTHENTICATED':
        return copy.errorAuth
      case 'NETWORK':
        return copy.errorNetwork
      case 'MALFORMED_RESPONSE':
        return copy.errorMalformed
      case 'BACKEND_VISION_UNAVAILABLE':
        return null // dedicated empty state below
      default:
        return copy.errorUnknown
    }
  }, [mutation.error, copy])

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.flex}
    >
      <Section title={copy.title} hint={copy.intent}>
        {photo ? (
          <View style={styles.previewWrap}>
            <Image
              source={{ uri: photo.uri }}
              style={styles.preview}
              resizeMode="cover"
              accessibilityLabel={copy.title}
            />
            <Pressable onPress={takePhoto} style={styles.retake}>
              <Text style={styles.retakeText}>{copy.retakeCta}</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.captureCta}
            onPress={takePhoto}
            style={({ pressed }) => [styles.captureBtn, pressed ? styles.captureBtnPressed : null]}
            testID="photo-advisor-capture"
          >
            <Text style={styles.captureLabel}>{copy.captureCta}</Text>
          </Pressable>
        )}
        {captureError === 'camera_denied' ? (
          <Text style={styles.warn}>{copy.cameraRequired}</Text>
        ) : null}
      </Section>

      {photo ? (
        <>
          <Section title={copy.gpsChip} {...gpsHintProp(gpsState, copy, coords)}>
            <Pressable
              onPress={requestLocation}
              style={({ pressed }) => [styles.gpsChip, pressed ? styles.gpsChipPressed : null]}
            >
              <Text style={styles.gpsChipText}>
                {coords
                  ? `${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}`
                  : gpsState === 'requesting'
                    ? copy.gpsRequesting
                    : gpsState === 'denied'
                      ? copy.gpsDenied
                      : copy.gpsRequired}
              </Text>
            </Pressable>
          </Section>

          <Section title={copy.prompt}>
            <TextInput
              accessibilityLabel={copy.prompt}
              value={prompt}
              onChangeText={setPrompt}
              placeholder={copy.promptPlaceholder}
              placeholderTextColor={colors.textMuted}
              multiline
              numberOfLines={3}
              style={styles.input}
              testID="photo-advisor-prompt"
            />
          </Section>

          <Section title={copy.analyzeCta}>
            <Button
              label={mutation.isPending ? copy.analyzing : copy.analyzeCta}
              onPress={submit}
              loading={mutation.isPending}
              disabled={mutation.isPending}
              testID="photo-advisor-submit"
            />
            {errorCopy ? <Text style={styles.error}>{errorCopy}</Text> : null}
          </Section>
        </>
      ) : null}

      {mutation.isSuccess && mutation.data ? (
        <ResponseSections response={mutation.data} copy={copy} onReset={reset} />
      ) : null}

      {mutation.error?.code === 'BACKEND_VISION_UNAVAILABLE' ? (
        <BackendUnavailableEmptyState copy={copy} />
      ) : null}
    </KeyboardAvoidingView>
  )
}

function gpsHintProp(
  state: 'idle' | 'requesting' | 'granted' | 'denied',
  copy: PhotoAdvisorCopy,
  coords: PhotoAdvisorLocation | null
): { hint: string } | Record<string, never> {
  if (state === 'granted' && coords?.accuracyMetres !== null && coords?.accuracyMetres !== undefined) {
    return { hint: `±${coords.accuracyMetres.toFixed(0)} m` }
  }
  if (state === 'denied') {
    return { hint: copy.gpsDenied }
  }
  return {}
}

type PhotoAdvisorCopy = ReturnType<typeof useI18n>['t']['photoAdvisor']

interface ResponseSectionsProps {
  response: PhotoAdvisorResponse
  copy: PhotoAdvisorCopy
  onReset: () => void
}

function ResponseSections({ response, copy, onReset }: ResponseSectionsProps): JSX.Element {
  return (
    <>
      <Section title={copy.summary}>
        <Text style={styles.bodyText}>{response.summary}</Text>
      </Section>
      <Section title={copy.reasoning}>
        <Text style={styles.bodyText}>{response.reasoning}</Text>
      </Section>
      {response.suggestions.length > 0 ? (
        <Section title={copy.suggestions}>
          {response.suggestions.map((s, idx) => (
            <Text key={`s-${idx}`} style={styles.bullet}>
              {`• ${s}`}
            </Text>
          ))}
        </Section>
      ) : null}
      {response.citations.length > 0 ? (
        <Section title={copy.citations}>
          {response.citations.map((c) => (
            <View key={c.evidenceId} style={styles.citation}>
              <Text style={styles.citationSource}>{c.source}</Text>
              <Text style={styles.citationExcerpt}>{c.excerpt}</Text>
            </View>
          ))}
        </Section>
      ) : null}
      <Button label={copy.retakeCta} variant="ghost" onPress={onReset} />
    </>
  )
}

function BackendUnavailableEmptyState({ copy }: { copy: PhotoAdvisorCopy }): JSX.Element {
  const contract = REQUIRED_BACKEND_CONTRACT
  return (
    <Section title={copy.backendUnavailableContract} hint={copy.backendUnavailable}>
      <View style={styles.contract}>
        <Text style={styles.contractHeader}>{`${contract.method} ${contract.path}`}</Text>
        <Text style={styles.contractLabel}>Request body</Text>
        <Text style={styles.contractCode}>{JSON.stringify(contract.requestExample, null, 2)}</Text>
        <Text style={styles.contractLabel}>Response shape</Text>
        <Text style={styles.contractCode}>{JSON.stringify(contract.responseShape, null, 2)}</Text>
      </View>
    </Section>
  )
}

const styles = StyleSheet.create({
  flex: {
    flex: 1
  },
  captureBtn: {
    minHeight: 180,
    borderRadius: radius.lg,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    shadowColor: colors.earth900,
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4
  },
  captureBtnPressed: {
    backgroundColor: colors.goldDark
  },
  captureLabel: {
    color: colors.earth900,
    fontSize: fontSize.h1,
    fontWeight: '800',
    letterSpacing: 0.5
  },
  previewWrap: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surfaceAlt
  },
  preview: {
    width: '100%',
    aspectRatio: 4 / 3
  },
  retake: {
    paddingVertical: spacing.md,
    alignItems: 'center',
    backgroundColor: colors.earth700
  },
  retakeText: {
    color: colors.textInverse,
    fontSize: fontSize.body,
    fontWeight: '700'
  },
  gpsChip: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.earth100,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border
  },
  gpsChipPressed: {
    backgroundColor: colors.earth300
  },
  gpsChipText: {
    color: colors.earth900,
    fontSize: fontSize.body,
    fontWeight: '600'
  },
  input: {
    minHeight: 96,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: fontSize.lead,
    textAlignVertical: 'top'
  },
  warn: {
    marginTop: spacing.md,
    color: colors.danger,
    fontSize: fontSize.body,
    fontWeight: '600'
  },
  error: {
    marginTop: spacing.md,
    color: colors.danger,
    fontSize: fontSize.body
  },
  bodyText: {
    color: colors.text,
    fontSize: fontSize.lead,
    lineHeight: 22
  },
  bullet: {
    color: colors.text,
    fontSize: fontSize.lead,
    marginTop: spacing.sm,
    lineHeight: 22
  },
  citation: {
    padding: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    marginTop: spacing.sm
  },
  citationSource: {
    color: colors.goldDark,
    fontSize: fontSize.body,
    fontWeight: '700'
  },
  citationExcerpt: {
    color: colors.text,
    fontSize: fontSize.body,
    marginTop: spacing.xs,
    fontStyle: 'italic'
  },
  contract: {
    padding: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md
  },
  contractHeader: {
    color: colors.earth900,
    fontSize: fontSize.lead,
    fontWeight: '700',
    marginBottom: spacing.sm
  },
  contractLabel: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    marginTop: spacing.sm,
    letterSpacing: 1,
    fontWeight: '700'
  },
  contractCode: {
    color: colors.text,
    fontSize: fontSize.caption,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    marginTop: spacing.xs
  }
})
