import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { requestOtp, verifyOtp } from '../api/client';
import { USING_LOCAL_API } from '../api/config';
import { fonts, radius } from '../theme/brand';
import { useTheme } from '../theme/ThemeProvider';

// Phone sign-in, mirroring the web Login screen. There is no SMS vendor, so a
// code can only be issued by a development API with ALLOW_DEV_OTP (the local
// test-branch server); it is shown on screen exactly as the web's dev mode
// does. Google Sign-In is the production login and needs the native Google
// SDK, which requires this app's own development build (not Expo Go).
export default function SignIn() {
  const { colors: c } = useTheme();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('+91');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sendCode() {
    setError(null);
    setBusy(true);
    const res = await requestOtp(phone.replace(/\s/g, ''));
    setBusy(false);
    if (!res.ok) {
      setError(
        'smsUnavailable' in res && res.smsUnavailable
          ? "Codes can't be sent by SMS yet. Phone sign-in only works against the local development API."
          : (res.error ?? "Couldn't send a code. Try again."),
      );
      return;
    }
    setDevCode('devOtp' in res && res.devOtp ? res.devOtp : null);
    setStep('code');
  }

  async function verify() {
    setError(null);
    setBusy(true);
    const res = await verifyOtp(phone.replace(/\s/g, ''), code);
    setBusy(false);
    if (!res.ok) setError(res.error ?? "That code didn't work.");
    // On success AuthProvider switches to the app.
  }

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.bg }]}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={[styles.eyebrow, { color: c.faint }]}>BANGALORE</Text>
          <Text style={[styles.title, { color: c.ink }]}>{step === 'phone' ? 'Sign in to Bhookmark' : 'Enter the code'}</Text>
          <Text style={[styles.lead, { color: c.muted }]}>
            {step === 'phone' ? 'Use your phone number.' : `We sent a 6-digit code to ${phone}.`}
          </Text>

          {step === 'phone' ? (
            <>
              <TextInput
                value={phone}
                onChangeText={setPhone}
                placeholder="+91 98765 43210"
                placeholderTextColor={c.faint}
                keyboardType="phone-pad"
                autoComplete="tel"
                textContentType="telephoneNumber"
                accessibilityLabel="Phone number"
                style={[styles.input, { color: c.ink, backgroundColor: c.surface, borderColor: c.line }]}
              />
              {error && <Text style={[styles.error, { color: c.bad }]}>{error}</Text>}
              <Pressable
                onPress={sendCode}
                disabled={busy}
                accessibilityRole="button"
                style={[styles.primary, { backgroundColor: c.accent, opacity: busy ? 0.6 : 1 }]}
              >
                <Text style={[styles.primaryText, { color: c.accentInk }]}>{busy ? 'Sending…' : 'Send code'}</Text>
              </Pressable>
            </>
          ) : (
            <>
              {devCode && (
                <View style={[styles.devBanner, { backgroundColor: c.accentDim, borderColor: c.accent }]}>
                  <Text style={[styles.devText, { color: c.rose }]}>
                    DEV MODE — no SMS provider is wired up, so here's the code directly:{' '}
                    <Text style={{ fontFamily: fonts.monoMedium }}>{devCode}</Text>
                  </Text>
                </View>
              )}
              <TextInput
                value={code}
                onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                placeholderTextColor={c.faint}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                accessibilityLabel="6-digit verification code"
                style={[styles.input, styles.codeInput, { color: c.ink, backgroundColor: c.surface, borderColor: c.line }]}
              />
              {error && <Text style={[styles.error, { color: c.bad }]}>{error}</Text>}
              <Pressable
                onPress={verify}
                disabled={busy || code.length !== 6}
                accessibilityRole="button"
                style={[styles.primary, { backgroundColor: c.accent, opacity: busy || code.length !== 6 ? 0.6 : 1 }]}
              >
                <Text style={[styles.primaryText, { color: c.accentInk }]}>{busy ? 'Verifying…' : 'Verify & continue'}</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setStep('phone');
                  setCode('');
                  setError(null);
                }}
                accessibilityRole="button"
                style={styles.link}
              >
                <Text style={[styles.linkText, { color: c.faint }]}>Use a different number</Text>
              </Pressable>
            </>
          )}

          <View style={styles.spacer} />
          <Text style={[styles.footnote, { color: c.faint }]}>
            {USING_LOCAL_API
              ? 'Development build: signed in against the local test API — your real account and data are not used.'
              : 'Google sign-in arrives with the app’s own build.'}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 48, paddingBottom: 32 },
  eyebrow: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1.5, marginBottom: 8 },
  title: { fontFamily: fonts.display, fontSize: 30, lineHeight: 35, marginBottom: 8 },
  lead: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, marginBottom: 28 },
  input: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 16, height: 52, fontFamily: fonts.body, fontSize: 16, marginBottom: 14 },
  codeInput: { fontFamily: fonts.mono, letterSpacing: 6, textAlign: 'center' },
  error: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, marginBottom: 14 },
  primary: { height: 52, borderRadius: radius.inner - 4, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontFamily: fonts.bodyMedium, fontSize: 16 },
  devBanner: { borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 14 },
  devText: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20 },
  link: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  linkText: { fontFamily: fonts.body, fontSize: 13, textDecorationLine: 'underline' },
  spacer: { flex: 1, minHeight: 32 },
  footnote: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, textAlign: 'center' },
});
