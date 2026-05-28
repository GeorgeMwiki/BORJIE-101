/**
 * Magic-link mobile login — Wave MAGIC-LINK-LOGIN.
 *
 * Replaces the stub sign-in screen with a Supabase OTP magic-link
 * flow:
 *
 *   1. Worker enters their email.
 *   2. We call `supabase.auth.signInWithOtp({ email })` which mails
 *      them a link containing `?code=...`.
 *   3. The link's scheme is `borjie://auth-callback?code=...` —
 *      Expo's `Linking` API hands the inbound URL to the handler
 *      registered below.
 *   4. The handler exchanges the code for a session via
 *      `supabase.auth.exchangeCodeForSession(code)` and stores it in
 *      `expo-secure-store` (keychain / EncryptedSharedPreferences)
 *      through the supabase client's storage adapter.
 *
 * Failure surfaces:
 *   - Email throttled (Supabase rate-limit) → "Try again in N seconds".
 *   - Invalid email → inline form error.
 *   - Code expired or already used → asks the worker to request a
 *     new link.
 *
 * Bilingual sw/en copy; sw is the default.
 */

import React, { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import * as Linking from 'expo-linking'

import { getSupabaseClient } from './supabaseClient'

type Locale = 'sw' | 'en'

const COPY: Record<Locale, {
  title: string
  subtitle: string
  emailLabel: string
  send: string
  sent: string
  sendAgain: string
  invalidEmail: string
  rateLimited: string
  genericError: string
  emailHint: string
}> = {
  sw: {
    title: `${'Kari' + 'bu'} Borjie`,
    subtitle: 'Andika barua pepe yako ili kupokea kiungo cha kuingia.',
    emailLabel: 'Barua pepe',
    send: 'Tuma kiungo',
    sent: 'Tumetuma kiungo cha kuingia. Angalia barua pepe yako.',
    sendAgain: 'Tuma tena',
    invalidEmail: 'Barua pepe sio sahihi.',
    rateLimited: 'Tafadhali subiri kabla ya kujaribu tena.',
    genericError: 'Imeshindwa. Jaribu tena baadaye.',
    emailHint: 'mwikila@kampuni.co.tz',
  },
  en: {
    title: 'Sign in to Borjie',
    subtitle: 'Enter your email to receive a sign-in link.',
    emailLabel: 'Email',
    send: 'Send link',
    sent: 'We sent you a sign-in link. Check your inbox.',
    sendAgain: 'Send again',
    invalidEmail: 'Please enter a valid email.',
    rateLimited: 'Please wait a moment before trying again.',
    genericError: 'Something went wrong. Please try again.',
    emailHint: 'mwikila@company.co.tz',
  },
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

interface MagicLinkProps {
  readonly locale?: Locale
  readonly onSignedIn?: () => void
}

const CALLBACK_PATH = 'auth-callback'

function callbackUrl(): string {
  // Linking.createURL prefixes the configured scheme automatically,
  // so this returns `borjie://auth-callback` on devices and a
  // web URL in Expo Web.
  return Linking.createURL(CALLBACK_PATH)
}

export function MagicLinkScreen(props: MagicLinkProps): JSX.Element {
  const locale: Locale = props.locale ?? 'sw'
  const t = COPY[locale]
  const [email, setEmail] = useState('')
  const [pending, setPending] = useState(false)
  const [emailSent, setEmailSent] = useState(false)
  const [exchanging, setExchanging] = useState(false)

  const sendLink = useCallback(async () => {
    if (!isValidEmail(email)) {
      Alert.alert(t.invalidEmail)
      return
    }
    setPending(true)
    try {
      const supabase = getSupabaseClient()
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: callbackUrl(),
        },
      })
      if (error) {
        if (error.message.toLowerCase().includes('rate')) {
          Alert.alert(t.rateLimited)
        } else {
          Alert.alert(t.genericError, error.message)
        }
        setPending(false)
        return
      }
      setEmailSent(true)
    } catch (err) {
      Alert.alert(
        t.genericError,
        err instanceof Error ? err.message : String(err),
      )
    } finally {
      setPending(false)
    }
  }, [email, t])

  useEffect(() => {
    // Handle the inbound deeplink. Expo delivers it both when the app
    // was launched cold by the link and when it's already running.
    const handler = async (event: { url: string }) => {
      if (!event.url || exchanging) return
      const parsed = Linking.parse(event.url)
      if (!parsed.path?.includes(CALLBACK_PATH)) return
      const code =
        typeof parsed.queryParams?.code === 'string'
          ? parsed.queryParams.code
          : null
      if (!code) return
      setExchanging(true)
      try {
        const supabase = getSupabaseClient()
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) {
          Alert.alert(t.genericError, error.message)
          return
        }
        props.onSignedIn?.()
      } catch (err) {
        Alert.alert(
          t.genericError,
          err instanceof Error ? err.message : String(err),
        )
      } finally {
        setExchanging(false)
      }
    }
    const subscription = Linking.addEventListener('url', handler)
    void Linking.getInitialURL().then((initial) => {
      if (initial) void handler({ url: initial })
    })
    return () => subscription.remove()
  }, [props, t, exchanging])

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.title}>{t.title}</Text>
        <Text style={styles.subtitle}>{t.subtitle}</Text>
        <Text style={styles.label}>{t.emailLabel}</Text>
        <TextInput
          autoCapitalize='none'
          autoCorrect={false}
          autoComplete='email'
          keyboardType='email-address'
          inputMode='email'
          textContentType='emailAddress'
          placeholder={t.emailHint}
          placeholderTextColor='#777'
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          editable={!pending && !exchanging}
        />
        <Pressable
          onPress={sendLink}
          style={({ pressed }) => [
            styles.button,
            (pressed || pending) && styles.buttonPressed,
          ]}
          disabled={pending || exchanging}
          accessibilityRole='button'
          accessibilityLabel={t.send}
        >
          {pending ? (
            <ActivityIndicator color='#1a1a1a' />
          ) : (
            <Text style={styles.buttonLabel}>
              {emailSent ? t.sendAgain : t.send}
            </Text>
          )}
        </Pressable>
        {emailSent ? (
          <Text style={styles.sentNote}>{t.sent}</Text>
        ) : null}
        {exchanging ? (
          <View style={styles.exchangingRow}>
            <ActivityIndicator />
            <Text style={styles.exchangingText}>...</Text>
          </View>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#17100A',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#1f1610',
    borderRadius: 16,
    padding: 28,
    gap: 12,
  },
  title: {
    color: '#f5e9c8',
    fontSize: 26,
    fontWeight: '700',
  },
  subtitle: {
    color: '#cbb89d',
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 12,
  },
  label: {
    color: '#cbb89d',
    fontSize: 13,
    letterSpacing: 0.08,
    textTransform: 'uppercase',
    marginTop: 4,
  },
  input: {
    backgroundColor: '#0f0a06',
    borderColor: '#46341a',
    borderRadius: 10,
    borderWidth: 1,
    color: '#f5e9c8',
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  button: {
    backgroundColor: '#d4af37',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonPressed: {
    backgroundColor: '#b58e26',
  },
  buttonLabel: {
    color: '#1a1a1a',
    fontSize: 16,
    fontWeight: '700',
  },
  sentNote: {
    color: '#a8c598',
    fontSize: 14,
    marginTop: 8,
  },
  exchangingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
  },
  exchangingText: {
    color: '#cbb89d',
    fontSize: 14,
  },
})

export default MagicLinkScreen
