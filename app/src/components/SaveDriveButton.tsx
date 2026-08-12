/**
 * Save-this-drive (M8-T04; FR-080). THE first gated action in the product —
 * tapping it anonymous opens the sign-in sheet via the FR-201 gate and the
 * save resumes automatically after verify. Saves are private by default
 * (server-enforced); honest states for saving/saved/problem.
 */

import type { Route } from '@shared/types';
import { useState, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { DataError } from '../lib/data';
import { getSupabaseConfig } from '../lib/runtime';
import { saveRoute } from '../lib/saves';
import { useAuth } from '../lib/use_auth';
import { font, HIT_TARGET, radius, spacing, useTheme } from '../theme';

export interface SaveDriveButtonProps {
  route: Route;
  agentExplanation?: string | null;
  /** Injectable for tests. */
  cfg?: { url: string; anonKey: string };
  saveFn?: typeof saveRoute;
}

/** Deterministic default name — the user renames from Saved later. */
export function defaultDriveName(route: Route): string {
  const mins = Math.round(route.duration_s / 60);
  return `${mins}-minute ${route.is_loop ? 'loop' : 'drive'}`;
}

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'problem'; message: string };

export default function SaveDriveButton(props: SaveDriveButtonProps): ReactElement {
  const { colors } = useTheme();
  const { gate, freshAccessToken } = useAuth();
  const cfg = props.cfg ?? getSupabaseConfig();
  const save = props.saveFn ?? saveRoute;
  const [state, setState] = useState<SaveState>({ kind: 'idle' });

  const doSave = (): void => {
    setState({ kind: 'saving' });
    void (async () => {
      try {
        const token = await freshAccessToken();
        if (!token) throw new DataError('Your session expired — sign in again.', null);
        await save(cfg, token, {
          route: props.route,
          name: defaultDriveName(props.route),
          agentExplanation: props.agentExplanation ?? null,
        });
        setState({ kind: 'saved' });
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
      <Text style={[styles.saved, { color: colors.success }]} accessibilityLabel="Drive saved">
        Saved to your drives ✓
      </Text>
    );
  }

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Save this drive"
        disabled={state.kind === 'saving'}
        onPress={() => gate(doSave)}
        style={({ pressed }) => [
          styles.button,
          {
            backgroundColor: colors.accent,
            opacity: state.kind === 'saving' ? 0.6 : pressed ? 0.8 : 1,
          },
        ]}
      >
        {state.kind === 'saving' ? (
          <ActivityIndicator color={colors.onAccent} />
        ) : (
          <Text style={[styles.label, { color: colors.onAccent }]}>Save this drive</Text>
        )}
      </Pressable>
      {state.kind === 'problem' && (
        <Text style={[styles.problem, { color: colors.danger }]}>{state.message}</Text>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: HIT_TARGET,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  label: { ...font.button },
  saved: { ...font.body, textAlign: 'center', marginTop: spacing.md },
  problem: { ...font.caption, textAlign: 'center', marginTop: spacing.xs },
});
