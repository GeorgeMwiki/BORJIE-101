import { useMemo } from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '../src/auth/AuthProvider'
import { createQueryClient } from '../src/api/queryClient'
import { BackgroundSyncMount } from '../src/sync/BackgroundSyncMount'
import { PilotErrorBoundary } from '../src/components/PilotErrorBoundary'
import { colors } from '../src/theme/colors'
import { ThemeProvider } from '../src/theme/ThemeProvider'
import { EventStreamMount } from '../src/lib/notifications/EventStreamMount'

export default function RootLayout(): JSX.Element {
  const queryClient = useMemo(() => createQueryClient(), [])
  return (
    <PilotErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.surface }}>
      <SafeAreaProvider>
        <ThemeProvider defaultTheme="dark">
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <BackgroundSyncMount />
            <EventStreamMount />
            <StatusBar style="light" backgroundColor={colors.earth700} />
            <Stack
              screenOptions={{
                headerStyle: { backgroundColor: colors.earth700 },
                headerTintColor: colors.textInverse,
                contentStyle: { backgroundColor: colors.surface },
                headerTitleStyle: { fontWeight: '700' }
              }}
            >
              <Stack.Screen name="index" options={{ headerShown: false }} />
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="onboarding" options={{ headerShown: false }} />
              <Stack.Screen
                name="onboarding/role"
                options={{ title: 'Borjie', headerShown: false }}
              />
              <Stack.Screen name="onboarding/welcome" options={{ headerShown: false }} />
              <Stack.Screen name="onboarding/phone" options={{ headerShown: false }} />
              <Stack.Screen name="onboarding/identity" options={{ headerShown: false }} />
              <Stack.Screen name="onboarding/role-detect" options={{ headerShown: false }} />
              <Stack.Screen name="onboarding/site" options={{ headerShown: false }} />
              <Stack.Screen name="onboarding/certifications" options={{ headerShown: false }} />
              <Stack.Screen name="onboarding/biometric" options={{ headerShown: false }} />
              <Stack.Screen name="onboarding/safety" options={{ headerShown: false }} />
              <Stack.Screen name="onboarding/calibration" options={{ headerShown: false }} />
              <Stack.Screen name="onboarding/done" options={{ headerShown: false }} />
              <Stack.Screen name="photo-advisor" options={{ headerShown: false }} />
              <Stack.Screen
                name="documents/[id]"
                options={{ title: 'Hati hai', headerShown: true }}
              />
              <Stack.Screen
                name="notifications/index"
                options={{ title: 'Arifa', headerShown: true }}
              />
            </Stack>
          </AuthProvider>
        </QueryClientProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
    </PilotErrorBoundary>
  )
}
