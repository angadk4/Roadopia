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
 */

import type { Route } from '@shared/types';
import { useState, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { DataError } from '../lib/data';
import { ROUTE_NAME_MAX } from '../lib/library';
import { getSupabaseConfig } from '../lib/runtime';
import { saveRoute } from '../lib/saves';
import { useAuth } from '../lib/use_auth';
import { font, HIT_TARGET, radius, spacing, useTheme } from '../theme';

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
      const token = await freshAccessToken();
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
      <View style={styles.savedWrap}>
        <Text style={[styles.saved, { color: colors.success }]} accessibilityLabel="Drive saved">
          {`Saved to your drives as “${state.name}” ✓`}
        </Text>
        {props.onViewSaved && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="View in Saved"
            onPress={props.onViewSaved}
            style={[styles.viewSaved, { borderColor: colors.accent }]}
          >
            <Text style={[styles.viewSavedLabel, { color: colors.accent }]}>View in Saved</Text>
          </Pressable>
        )}
      </View>
    );
  }

  const saving = state.kind === 'saving';
  return (
    <View style={styles.wrap}>
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
          { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface },
        ]}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Save this drive"
        disabled={saving}
        onPress={() => gate(doSave, { onDismiss })}
        style={({ pressed }) => [
          styles.button,
          {
            backgroundColor: colors.accent,
            opacity: saving ? 0.6 : pressed ? 0.8 : 1,
          },
        ]}
      >
        {saving ? (
          <ActivityIndicator color={colors.onAccent} />
        ) : (
          <Text style={[styles.label, { color: colors.onAccent }]}>Save this drive</Text>
        )}
      </Pressable>
      {state.kind === 'problem' && (
        <Text style={[styles.problem, { color: colors.danger }]}>{state.message}</Text>
      )}
      {state.kind === 'dropped' && (
        <Text style={[styles.problem, { color: colors.textMuted }]}>
          Not saved — sign in to keep this drive.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm, marginTop: spacing.md },
  nameInput: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: HIT_TARGET,
    ...font.body,
  },
  button: {
    minHeight: HIT_TARGET,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { ...font.button },
  savedWrap: { gap: spacing.sm, marginTop: spacing.md, alignItems: 'center' },
  saved: { ...font.body, textAlign: 'center' },
  viewSaved: {
    minHeight: HIT_TARGET,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewSavedLabel: { ...font.button },
  problem: { ...font.caption, textAlign: 'center' },
});
