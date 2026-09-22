/**
 * Save-this-drive (M8-T04; FR-080). THE first gated action in the product —
 * tapping it anonymous opens the sign-in sheet via the FR-201 gate and the
 * save resumes automatically after verify. Saves are private by default
 * (server-enforced); honest states for saving/saved/problem.
 *
 * Device pass (2026-09-04): the drive is NAMED here — the old comment
 * promised a rename "from Saved later" that did not exist, so every loop was
 * "42-minute loop" forever. A dismissed sign-in sheet now says what did not
 * happen; a lapsed session re-opens the sheet with this save parked instead
 * of a dead "sign in again" line; a successful save offers the way to Saved.
 *
 * Redesign (SPEC "Shared pieces > SaveDriveButton"). The name field gets a
 * `Legend` "NAME" kicker — the atlas device for "this is the field's label" —
 * and the control stays `secondary`: the host page's ONE filled amber is
 * Follow, and two stacked amber primaries is exactly the "one accent, every
 * job" problem BD-204 set out to fix. The payoff (rare tier — delight budget,
 * expo-animation §1) is an inset card that ENTERS with the shared `ENTER`
 * builder while the `checkmark.circle.fill` plays SF Symbols' own `bounce`
 * effect — the platform's celebration, not a hand-rolled one — and the
 * success haptic lands the same frame (SPEC haptics policy: save →
 * `notificationAsync(Success)`, one per user action, never the only
 * feedback). Under Reduce Motion the fade stays and the bounce goes.
 *
 * Failure lines stay LEFT-aligned under the control they belong to (centred
 * error text under a left-aligned form reads as another app's UI), verbatim.
 */

import type { Route } from '@shared/types';
import { notificationAsync, NotificationFeedbackType } from 'expo-haptics';
import type { AnimationSpec } from 'expo-symbols';
import { useState, type ReactElement } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { sessionProblem } from '../lib/auth_state';
import { DataError } from '../lib/data';
import { ROUTE_NAME_MAX } from '../lib/library';
import { getSupabaseConfig } from '../lib/runtime';
import { saveRoute } from '../lib/saves';
import { useAuth } from '../lib/use_auth';
import { font, HIT_TARGET, radius, spacing, squircle, useTheme } from '../theme';

import {
  Button,
  Legend,
  Surface,
  Symbol,
  Text,
  useEntering,
  useReducedMotion,
  type SymbolKey,
} from './ui';

export interface SaveDriveButtonProps {
  route: Route;
  agentExplanation?: string | null;
  /** When given, a successful save offers "View in Saved" that calls this. */
  onViewSaved?: () => void;
  /** Injectable for tests. */
  cfg?: { url: string; anonKey: string };
  saveFn?: typeof saveRoute;
}

/** Deterministic default name — prefilled into the name field, editable. */
export function defaultDriveName(route: Route): string {
  const mins = Math.round(route.duration_s / 60);
  return `${mins}-minute ${route.is_loop ? 'loop' : 'drive'}`;
}

/** The payoff mark's SF Symbols effect: one bounce, the frame the card lands. */
const SAVED_BOUNCE: AnimationSpec = { effect: { type: 'bounce' } };

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; name: string }
  /** The sign-in sheet was dismissed with this save parked — nothing saved. */
  | { kind: 'dropped' }
  | { kind: 'problem'; message: string };

export default function SaveDriveButton(props: SaveDriveButtonProps): ReactElement {
  const { colors } = useTheme();
  const { gate, freshAccessToken } = useAuth();
  const cfg = props.cfg ?? getSupabaseConfig();
  const save = props.saveFn ?? saveRoute;
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const [name, setName] = useState(() => defaultDriveName(props.route));

  const chosenName = (): string =>
    name.trim().slice(0, ROUTE_NAME_MAX) || defaultDriveName(props.route);

  const onDismiss = (): void => setState({ kind: 'dropped' });

  const doSave = (): void => {
    setState({ kind: 'saving' });
    void (async () => {
      let token: string | null;
      try {
        token = await freshAccessToken();
      } catch (err) {
        // the refresh could not be reached or answered: the session is still
        // held, so say what happened and leave a retry one tap away
        setState({ kind: 'problem', message: sessionProblem(err) });
        return;
      }
      if (!token) {
        // The session lapsed between the tap and the save (refresh refused):
        // the engine is anonymous again, so re-gating re-opens the sheet with
        // THIS save parked — no "sign in again" line with nothing to press.
        setState({ kind: 'idle' });
        gate(doSave, { onDismiss });
        return;
      }
      try {
        const finalName = chosenName();
        await save(cfg, token, {
          route: props.route,
          name: finalName,
          agentExplanation: props.agentExplanation ?? null,
        });
        setState({ kind: 'saved', name: finalName });
        // Same frame as the card landing; the visual stands alone without it.
        void notificationAsync(NotificationFeedbackType.Success);
      } catch (err) {
        setState({
          kind: 'problem',
          message: err instanceof DataError ? err.message : 'Could not save the drive.',
        });
      }
    })();
  };

  if (state.kind === 'saved') {
    return (
      <SavedConfirmation
        name={state.name}
        {...(props.onViewSaved ? { onViewSaved: props.onViewSaved } : {})}
      />
    );
  }

  const saving = state.kind === 'saving';
  return (
    <View style={styles.wrap}>
      <View style={styles.nameField}>
        <Legend>Name</Legend>
        <TextInput
          accessibilityLabel="Drive name"
          value={name}
          onChangeText={(t) => setName(t.slice(0, ROUTE_NAME_MAX))}
          placeholder={defaultDriveName(props.route)}
          placeholderTextColor={colors.textMuted}
          editable={!saving}
          maxLength={ROUTE_NAME_MAX}
          returnKeyType="done"
          style={[
            styles.nameInput,
            { color: colors.text, borderColor: colors.borderStrong, backgroundColor: colors.fill },
          ]}
        />
      </View>
      {/* SECONDARY on purpose: Follow owns the page's one filled amber (see
          the header). `secondary` still carries a recessed fill AND the index
          rule, so it reads as a control before it reads as a label. */}
      <Button
        title="Save this drive"
        variant="secondary"
        block
        loading={saving}
        icon={<Symbol name="bookmark" size="md" tone="default" />}
        onPress={() => gate(doSave, { onDismiss })}
      />
      {state.kind === 'problem' && (
        <Note symbol="exclamationmarkCircleFill" tone="danger" text={state.message} />
      )}
      {state.kind === 'dropped' && (
        <Note symbol="infoCircle" tone="muted" text="Not saved — sign in to keep this drive." />
      )}
    </View>
  );
}

/** A failure sits UNDER the control it belongs to, left-aligned with it. */
function Note(props: {
  symbol: Extract<SymbolKey, 'exclamationmarkCircleFill' | 'infoCircle'>;
  tone: 'danger' | 'muted';
  text: string;
}): ReactElement {
  return (
    <View style={styles.note}>
      <View style={styles.noteMark}>
        <Symbol name={props.symbol} size="sm" tone={props.tone} />
      </View>
      <Text variant="footnote" tone={props.tone} style={styles.flex}>
        {props.text}
      </Text>
    </View>
  );
}

/** The payoff: the card enters as one piece; the mark bounces the frame it
 *  lands. Rare tier, purpose "delight" (expo-animation §1–2). */
function SavedConfirmation(props: { name: string; onViewSaved?: () => void }): ReactElement {
  const entering = useEntering();
  const reduced = useReducedMotion();
  return (
    <Animated.View entering={entering} style={styles.savedWrap}>
      <Surface level="inset" padding="md" style={styles.saved}>
        <View style={styles.savedLine}>
          <Symbol
            name="checkmarkCircleFill"
            size="xl"
            tone="success"
            {...(reduced ? {} : { animationSpec: SAVED_BOUNCE })}
          />
          <Text
            variant="bodyStrong"
            style={styles.flex}
            accessibilityLabel="Drive saved"
          >{`Saved to your drives as “${props.name}”`}</Text>
        </View>
        {props.onViewSaved && (
          <Button
            title="View in Saved"
            variant="secondary"
            block
            icon={<Symbol name="bookmark" size="sm" tone="default" />}
            onPress={props.onViewSaved}
          />
        )}
      </Surface>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md, marginTop: spacing.md },
  nameField: { gap: spacing.xs },
  nameInput: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: HIT_TARGET,
    ...font.body,
    ...squircle,
  },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  noteMark: { paddingTop: 2 },
  flex: { flex: 1 },
  savedWrap: { marginTop: spacing.md },
  saved: { gap: spacing.md },
  savedLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
