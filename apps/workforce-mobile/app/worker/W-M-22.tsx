import { useCallback, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'W-M-22'

type DownloadState = 'downloaded' | 'streaming' | 'queued'

interface TrainingVideo {
  id: string
  title: string
  durationMin: number
  fileMb: number
  state: DownloadState
  topic: string
}

const SEED_VIDEOS: ReadonlyArray<TrainingVideo> = [
  {
    id: 'v-1',
    title: 'Jinsi ya kuvaa PPE kwa usahihi',
    durationMin: 2,
    fileMb: 8.4,
    state: 'downloaded',
    topic: 'Usalama'
  },
  {
    id: 'v-2',
    title: 'Jinsi ya kurekodi shifti — fomu W-M-04',
    durationMin: 3,
    fileMb: 11.2,
    state: 'downloaded',
    topic: 'Mafunzo'
  },
  {
    id: 'v-3',
    title: 'Hatari ya pit slope kwenye mvua',
    durationMin: 4,
    fileMb: 14.8,
    state: 'downloaded',
    topic: 'Usalama'
  },
  {
    id: 'v-4',
    title: 'Kuripoti tukio — fomu W-M-14',
    durationMin: 5,
    fileMb: 18.6,
    state: 'streaming',
    topic: 'Mafunzo'
  },
  {
    id: 'v-5',
    title: 'Lockout / Tagout kwa generator',
    durationMin: 6,
    fileMb: 22.1,
    state: 'queued',
    topic: 'Usalama'
  }
]

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <TrainingLibrary />
      </ScreenShell>
    </RoleGuard>
  )
}

function TrainingLibrary(): JSX.Element {
  const [videos, setVideos] = useState<ReadonlyArray<TrainingVideo>>(SEED_VIDEOS)
  const [playingId, setPlayingId] = useState<string | null>(null)

  const play = useCallback((id: string): void => {
    setPlayingId(id)
  }, [])

  const downloadOne = useCallback(
    (id: string): void => {
      setVideos(
        videos.map((video) =>
          video.id === id && video.state !== 'downloaded'
            ? { ...video, state: 'downloaded' }
            : video
        )
      )
    },
    [videos]
  )

  const downloadedCount = useMemo<number>(
    () => videos.filter((video) => video.state === 'downloaded').length,
    [videos]
  )

  const totalSizeMb = useMemo<number>(
    () =>
      videos
        .filter((video) => video.state === 'downloaded')
        .reduce((sum, video) => sum + video.fileMb, 0),
    [videos]
  )

  return (
    <View>
      <Section title={`Mafunzo · Kiswahili (${downloadedCount} offline)`}>
        <View style={styles.summary}>
          <Text style={styles.summaryLabel}>Zinapatikana bila mtandao</Text>
          <Text style={styles.summaryValue}>
            {downloadedCount} video · {totalSizeMb.toFixed(1)} MB
          </Text>
        </View>
      </Section>
      <Section title="Orodha ya video">
        {videos.map((video) => (
          <Pressable
            key={video.id}
            accessibilityRole="button"
            accessibilityLabel={video.title}
            onPress={() => play(video.id)}
            style={({ pressed }) => [
              styles.videoRow,
              playingId === video.id ? styles.videoRowActive : null,
              pressed && styles.pressed
            ]}
          >
            <View style={styles.playIcon}>
              <Text style={styles.playIconLabel}>▶</Text>
            </View>
            <View style={styles.videoBody}>
              <Text style={styles.videoTitle}>{video.title}</Text>
              <Text style={styles.videoMeta}>
                {video.topic} · {video.durationMin} min · {video.fileMb.toFixed(1)} MB
              </Text>
              <View style={styles.statusContainer}>
                <View style={[styles.statusDot, dotStyleFor(video.state)]} />
                <Text style={styles.statusText}>{stateLabel(video.state)}</Text>
                {video.state !== 'downloaded' ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Pakua"
                    onPress={() => downloadOne(video.id)}
                    style={({ pressed }) => [styles.downloadLink, pressed && styles.pressed]}
                  >
                    <Text style={styles.downloadLinkLabel}>Pakua</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          </Pressable>
        ))}
      </Section>
    </View>
  )
}

function stateLabel(state: DownloadState): string {
  if (state === 'downloaded') return 'Offline · tayari'
  if (state === 'streaming') return 'Inahitaji mtandao'
  return 'Inasubiri sync'
}

function dotStyleFor(state: DownloadState): { backgroundColor: string } {
  if (state === 'downloaded') return { backgroundColor: colors.success }
  if (state === 'streaming') return { backgroundColor: colors.warn }
  return { backgroundColor: colors.textMuted }
}

const styles = StyleSheet.create({
  summary: {
    padding: spacing.lg,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderLeftWidth: 4,
    borderLeftColor: colors.gold
  },
  summaryLabel: {
    color: colors.textMuted,
    fontSize: fontSize.body
  },
  summaryValue: {
    color: colors.text,
    fontSize: fontSize.h3,
    fontWeight: '700',
    marginTop: spacing.xs
  },
  videoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: 'transparent'
  },
  videoRowActive: {
    borderColor: colors.gold,
    backgroundColor: colors.surface
  },
  pressed: {
    opacity: 0.85
  },
  playIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md
  },
  playIconLabel: {
    color: colors.earth900,
    fontSize: fontSize.lead,
    fontWeight: '700'
  },
  videoBody: {
    flex: 1
  },
  videoTitle: {
    color: colors.text,
    fontSize: fontSize.lead,
    fontWeight: '600'
  },
  videoMeta: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    marginTop: spacing.xs
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    gap: spacing.sm
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill
  },
  statusText: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    fontWeight: '600'
  },
  downloadLink: {
    marginLeft: 'auto',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.earth700,
    borderRadius: radius.sm
  },
  downloadLinkLabel: {
    color: colors.textInverse,
    fontSize: fontSize.caption,
    fontWeight: '700'
  }
})
