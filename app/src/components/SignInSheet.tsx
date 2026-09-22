/**
 * Sign-in body (M8-T01; FR-200/201/206). Appears ONLY when a gated action is
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
 * the sheet rides above the keyboard (now the platform sheet's own keyboard
 * avoidance — see below), and tapping the empty ground of the sheet dismisses
 * the keyboard without cancelling the sheet.
 *
 * REDESIGN (SPEC "SignInSheet"). Every line of the behaviour above is
 * unchanged. What changed is WHERE it lives: this is no longer an RN `Modal`
 * with a scrim, a drawn grabber, a `Surface` rising through `useEnter` and a
 * `KeyboardAvoidingView` — it is the BODY of a root-stack `formSheet` route
 * (`nav/RootStack`, `screens/SignInScreen`), a real
 * `UISheetPresentationController` that brings the grabber, the corner radius,
 * the dimming, drag-to-dismiss and keyboard avoidance with it. So:
 *
 *  - `SignInBody` is the form. Its root is explicitly sized (padding + gap,
 *    no `flex: 1`) because the sheet's `fitToContents` detent measures it.
 *  - The root is a `Pressable` labelled "Dismiss keyboard" with NO role and
 *    `accessible={false}`: a tap on the sheet's empty ground lowers the
 *    keyboard, and an accessible wrapper would swallow every control inside
 *    it for VoiceOver. The inputs and buttons take their own taps first.
 *  - A step change (email → code, and back) is an in-place swap, so it must
 *    not travel: the step's block is keyed and fades in over 140 ms
 *    (`ENTER_REDUCED` — a FadeIn at the cross-fade duration that also plays
 *    under Reduce Motion, which is right here: there is no rise to remove,
 *    and a popped swap reads as a glitch).
 *  - Haptics (SPEC "Haptics policy"): `Success` the moment `verifyCode`
 *    resolves — the parked action is resuming; `Error` when the code is
 *    refused. One per user action, never the only feedback (the problem line
 *    and the state change are the visual half).
 *  - The default export still renders the body inline while `sheetOpen`, so
 *    the existing node test drives the same form the route mounts.
 *
 * The 6-digit field is set large with tabular numerals and 8pt of tracking,
 * with matching left padding: `letterSpacing` also tracks AFTER the last
 * character, so a centred 6-digit string sat ~4pt left of true centre.
 */

import { notificationAsync, NotificationFeedbackType } from 'expo-haptics';
import { useEffect, useState, type ReactElement } from 'react';
import { Keyboard, Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { AuthApiError } from '../lib/auth';
import { useBottomInset } from '../lib/insets';
import { useAuth } from '../lib/use_auth';
import { font, HIT_TARGET, radius, spacing, squircle, useTheme } from '../theme';

import { Button, ENTER_REDUCED, Row, Symbol, Text } from './ui';

type Step = 'email' | 'code';

/** Resend is offered after this many seconds (email delivery lag, not abuse). */
export const RESEND_COOLDOWN_S = 30;

/**
 * The form. Mounted by the `SignIn` route (`screens/SignInScreen`) inside the
 * platform's form sheet; rendered inline by the default export under test.
 */
export function SignInBody(): ReactElement {
  const { colors } = useTheme();
  const { dismissSheet, sendCode, verifyCode } = useAuth();
  const bottomInset = useBottomInset();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /** When "Resend code" becomes available (epoch ms), or null when it is.
   *  A code that never arrives used to leave "Use a different email" as the
   *  only way out (device pass); the cooldown keeps a stuck tap from
   *  hammering the OTP endpoint. Wall-clock based, not a chained countdown,
   *  so a throttled interval in the background cannot make it drift. */
  const [resendAt, setResendAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (resendAt === null) return undefined;
    const id = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n >= resendAt) setResendAt(null);
    }, 1000);
    return () => clearInterval(id);
  }, [resendAt]);

  const resendIn = resendAt === null ? 0 : Math.max(0, Math.ceil((resendAt - now) / 1000));
  const startCooldown = (): void => {
    const at = Date.now();
    setNow(at);
    setResendAt(at + RESEND_COOLDOWN_S * 1000);
  };

  const reset = (): void => {
    setStep('email');
    setCode('');
    setBusy(false);
    setProblem(null);
    setResendAt(null);
  };

  const resend = (): void => {
    if (resendIn > 0 || busy) return;
    setProblem(null);
    startCooldown();
    sendCode(email.trim().toLowerCase()).catch((err: unknown) => {
      setProblem(friendly(err));
      setResendAt(null); // a failed send should not lock the button
    });
  };

  /** "Not now": the engine closes the sheet (the route pops from that) and
   *  drops the parked action, telling its owner what did not happen. */
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
        startCooldown();
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
      .then(() => {
        // the parked action is resuming: the one Success of this flow
        void notificationAsync(NotificationFeedbackType.Success);
        reset(); // sheet closes via state; the route pops from that
      })
      .catch((err: unknown) => {
        void notificationAsync(NotificationFeedbackType.Error);
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
    // Tapping the sheet's empty ground lowers the keyboard; it never cancels
    // the sheet (that is "Not now" — an accidental tap must not drop the
    // parked action). No role, not an accessibility element: the controls
    // inside stay individually reachable.
    <Pressable
      style={[styles.body, { paddingBottom: spacing.lg + bottomInset }]}
      onPress={() => Keyboard.dismiss()}
      accessibilityLabel="Dismiss keyboard"
      accessible={false}
    >
      <Animated.View key={step} entering={ENTER_REDUCED} style={styles.step}>
        <Text variant="title">{step === 'email' ? 'Sign in to save' : 'Enter the code'}</Text>
        <Text variant="footnote" tone="muted">
          {step === 'email'
            ? 'Saving drives needs an account. We’ll email you a 6-digit code — no password.'
            : `We sent a code to ${email.trim()}. Type it in — it signs you in automatically.`}
        </Text>

        {step === 'email' ? (
          <TextInput
            style={[
              styles.input,
              {
                color: colors.text,
                borderColor: colors.borderStrong,
                backgroundColor: colors.fill,
              },
            ]}
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
              {
                color: colors.text,
                borderColor: colors.borderStrong,
                backgroundColor: colors.fill,
              },
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
          <View style={styles.problem}>
            <View style={styles.problemMark}>
              <Symbol name="exclamationmarkCircleFill" size="sm" tone="danger" />
            </View>
            <Text variant="footnote" tone="danger" style={styles.flex}>
              {problem}
            </Text>
          </View>
        )}

        <Button
          title={step === 'email' ? 'Send code' : 'Verify'}
          accessibilityLabel={step === 'email' ? 'Send code' : 'Verify code'}
          variant="primary"
          size="lg"
          block
          loading={busy}
          onPress={() => (step === 'email' ? submitEmail() : submitCode())}
        />

        <Row onPress={close} accessibilityLabel="Not now" style={styles.quiet}>
          <Text variant="label" tone="muted" style={styles.centred}>
            Not now
          </Text>
        </Row>

        {step === 'code' && (
          <>
            <Row
              onPress={resend}
              disabled={resendIn > 0 || busy}
              accessibilityLabel="Resend code"
              style={styles.quiet}
            >
              <Text variant="label" tone={resendIn > 0 ? 'muted' : 'accent'} style={styles.centred}>
                {resendIn > 0 ? `Resend code in ${resendIn} s` : 'Resend code'}
              </Text>
            </Row>
            <Row onPress={reset} accessibilityLabel="Use a different email" style={styles.quiet}>
              <Text variant="footnote" tone="muted" style={styles.centred}>
                Use a different email
              </Text>
            </Row>
          </>
        )}
      </Animated.View>
    </Pressable>
  );
}

/**
 * The body, inline, while the engine says the sheet is open — what the node
 * test renders. The app itself mounts the body through the `SignIn` route.
 */
export default function SignInSheet(): ReactElement | null {
  const { sheetOpen } = useAuth();
  return sheetOpen ? <SignInBody /> : null;
}

const styles = StyleSheet.create({
  /** Explicitly sized (no flex): the sheet's `fitToContents` measures this.
   *  `paddingTop` clears the platform grabber; the bottom pad is added at
   *  render, with the home-indicator inset (review finding: the button row
   *  sat inside the strip). */
  body: {
    paddingTop: spacing.xl,
    paddingHorizontal: spacing.gutter,
  },
  step: { gap: spacing.md },
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: HIT_TARGET,
    ...font.body,
    ...squircle,
  },
  /** paddingLeft compensates the tracking that trails the LAST digit, which
   *  otherwise pushes a centred code ~4pt left of true centre. */
  codeInput: {
    ...font.statLg,
    letterSpacing: 8,
    paddingLeft: 8,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
    minHeight: 56,
  },
  problem: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  problemMark: { paddingTop: 2 },
  flex: { flex: 1 },
  /** A dismissive action is a full-width quiet line, not a competing pill. */
  quiet: { marginTop: -spacing.xs },
  centred: { textAlign: 'center' },
});
