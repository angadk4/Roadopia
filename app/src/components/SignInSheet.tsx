/**
 * Sign-in sheet (M8-T01; FR-200/201/206). Appears ONLY when a gated action is
 * tapped while anonymous — never at launch, never blocking browse/plan. Email
 * OTP: address → 6-digit code → done; the parked action resumes automatically
 * on success (AuthEngine.verifyCode). Honest error states (§18): friendly
 * words, never a raw server dump; dismissing is always allowed and simply
 * drops the parked action.
 *
 * KEYBOARD (owner device pass, 2026-08-12): iOS's number pad has NO return key,
 * so a bottom sheet + numeric input is a trap — the keyboard covers the submit
 * button with no way to dismiss it. Three fixes, in order of what a user hits
 * first: the 6th digit AUTO-SUBMITS (a fixed-length code never needs a button),
 * the sheet rides above the keyboard (KeyboardAvoidingView), and tapping the
 * backdrop dismisses the keyboard without cancelling the sheet.
 */

import { useState, type ReactElement } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AuthApiError } from '../lib/auth';
import { useAuth } from '../lib/use_auth';
import { font, HIT_TARGET, radius, spacing, useTheme } from '../theme';

type Step = 'email' | 'code';

export default function SignInSheet(): ReactElement | null {
  const { colors } = useTheme();
  const { sheetOpen, dismissSheet, sendCode, verifyCode } = useAuth();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (!sheetOpen) return null;

  const reset = (): void => {
    setStep('email');
    setCode('');
    setBusy(false);
    setProblem(null);
  };

  const close = (): void => {
    reset();
    dismissSheet();
  };

  const friendly = (err: unknown): string =>
    err instanceof AuthApiError ? err.message : 'Something went wrong — try again.';

  const submitEmail = (): void => {
    const addr = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) {
      setProblem('That doesn’t look like an email address.');
      return;
    }
    setBusy(true);
    setProblem(null);
    sendCode(addr)
      .then(() => {
        setStep('code');
        setBusy(false);
      })
      .catch((err: unknown) => {
        setProblem(friendly(err));
        setBusy(false);
      });
  };

  const submitCode = (value?: string): void => {
    // the auto-submit path passes the digits explicitly: setCode() has not
    // re-rendered yet when the 6th keystroke fires
    const trimmed = (value ?? code).trim();
    if (!/^\d{6}$/.test(trimmed)) {
      setProblem('The code is the 6 digits from the email.');
      return;
    }
    Keyboard.dismiss();
    setBusy(true);
    setProblem(null);
    verifyCode(email.trim().toLowerCase(), trimmed)
      .then(() => reset()) // sheet closes via state; parked action resumes
      .catch((err: unknown) => {
        setProblem(friendly(err));
        setBusy(false);
      });
  };

  /** Digits only; the 6th one submits — no button press, no keyboard fight. */
  const onCodeChange = (text: string): void => {
    const digits = text.replace(/\D/g, '').slice(0, 6);
    setCode(digits);
    if (digits.length === 6 && !busy) submitCode(digits);
  };

  return (
    <Modal transparent animationType="fade" visible onRequestClose={close}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* tapping above the sheet lowers the keyboard; it never cancels the
            sheet (that is "Not now" — an accidental tap must not drop the
            parked action) */}
        <Pressable
          style={styles.dismissArea}
          onPress={() => Keyboard.dismiss()}
          accessibilityLabel="Dismiss keyboard"
        />
        <View
          style={[
            styles.sheet,
            { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.title, { color: colors.text }]}>
            {step === 'email' ? 'Sign in to save' : 'Enter the code'}
          </Text>
          <Text style={[styles.hint, { color: colors.textMuted }]}>
            {step === 'email'
              ? 'Saving drives needs an account. We’ll email you a 6-digit code — no password.'
              : `We sent a code to ${email.trim()}. Type it in — it signs you in automatically.`}
          </Text>

          {step === 'email' ? (
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.border }]}
              placeholder="you@example.com"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              returnKeyType="send"
              onSubmitEditing={submitEmail}
              value={email}
              onChangeText={setEmail}
              editable={!busy}
              accessibilityLabel="Email address"
            />
          ) : (
            <TextInput
              style={[
                styles.input,
                styles.codeInput,
                { color: colors.text, borderColor: colors.border },
              ]}
              placeholder="123456"
              placeholderTextColor={colors.textMuted}
              keyboardType="number-pad"
              maxLength={6}
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              autoFocus
              value={code}
              onChangeText={onCodeChange}
              editable={!busy}
              accessibilityLabel="6-digit code"
            />
          )}

          {problem !== null && (
            <Text style={[styles.problem, { color: colors.danger }]}>{problem}</Text>
          )}

          <View style={styles.row}>
            <Pressable
              onPress={close}
              style={styles.secondary}
              accessibilityRole="button"
              accessibilityLabel="Not now"
            >
              <Text style={[styles.secondaryText, { color: colors.textMuted }]}>Not now</Text>
            </Pressable>
            <Pressable
              onPress={() => (step === 'email' ? submitEmail() : submitCode())}
              disabled={busy}
              style={[styles.primary, { backgroundColor: colors.accent, opacity: busy ? 0.6 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel={step === 'email' ? 'Send code' : 'Verify code'}
            >
              {busy ? (
                <ActivityIndicator color={colors.onAccent} />
              ) : (
                <Text style={[styles.primaryText, { color: colors.onAccent }]}>
                  {step === 'email' ? 'Send code' : 'Verify'}
                </Text>
              )}
            </Pressable>
          </View>

          {step === 'code' && (
            <Pressable
              onPress={() => {
                reset();
              }}
              accessibilityRole="button"
              accessibilityLabel="Use a different email"
            >
              <Text style={[styles.switchText, { color: colors.textMuted }]}>
                Use a different email
              </Text>
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  dismissArea: { flex: 1 },
  sheet: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: { ...font.heading },
  hint: { ...font.caption, lineHeight: 19 },
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: HIT_TARGET,
    fontSize: font.body.fontSize,
  },
  codeInput: { letterSpacing: 8, textAlign: 'center', fontSize: font.heading.fontSize },
  problem: { ...font.caption },
  row: { flexDirection: 'row', gap: spacing.md, justifyContent: 'flex-end' },
  primary: {
    minHeight: HIT_TARGET,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { ...font.button },
  secondary: { minHeight: HIT_TARGET, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { ...font.body },
  switchText: { ...font.caption, textAlign: 'center' },
});
