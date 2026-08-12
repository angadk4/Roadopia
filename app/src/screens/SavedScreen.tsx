/**
 * Saved tab — profile + owned content (M8-T02; FR-090/091).
 *
 * Anonymous: an honest explainer + a "Sign in" button that goes through the
 * SAME gate primitive as every gated action (FR-201 — the button's action is
 * simply "load my profile"). Signed in: display name (editable inline, cap
 * mirrored from the DB), email, sign-out, and the owned-content sections —
 * which say honestly that saves land with the next build until M8-T04 wires
 * them (§18: never a dead end, never a fake).
 */

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { DataError } from '../lib/data';
import { DISPLAY_NAME_MAX, fetchProfile, updateDisplayName, type Profile } from '../lib/profile';
import { getSupabaseConfig } from '../lib/runtime';
import { listMyRoutes, type SavedRow } from '../lib/saves';
import { useAuth } from '../lib/use_auth';
import { font, HIT_TARGET, radius, spacing, useTheme } from '../theme';

export interface SavedScreenProps {
  /** Injectable for tests; defaults to the runtime Supabase config. */
  cfg?: { url: string; anonKey: string };
  fetchProfileFn?: typeof fetchProfile;
  updateNameFn?: typeof updateDisplayName;
  listRoutesFn?: typeof listMyRoutes;
}

export default function SavedScreen(props: SavedScreenProps): ReactElement {
  const { colors } = useTheme();
  const { status, user, gate, signOut, freshAccessToken } = useAuth();
  const cfg = props.cfg ?? getSupabaseConfig();
  const loadProfile = props.fetchProfileFn ?? fetchProfile;
  const saveName = props.updateNameFn ?? updateDisplayName;
  const loadRoutes = props.listRoutesFn ?? listMyRoutes;

  const [profile, setProfile] = useState<Profile | null>(null);
  const [drives, setDrives] = useState<SavedRow[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const refresh = useCallback((): void => {
    if (!user) return;
    loadProfile(cfg, user.id)
      .then((p) => {
        setProfile(p);
        setProblem(null);
      })
      .catch((err: unknown) => {
        setProblem(err instanceof DataError ? err.message : 'Could not load the profile.');
      });
    void (async () => {
      try {
        const token = await freshAccessToken();
        if (!token) return; // silently anon again — the screen re-renders
        setDrives(await loadRoutes(cfg, token, user.id));
      } catch {
        setDrives(null); // list problem is non-fatal; profile row still shows
      }
    })();
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (status === 'signedIn') refresh();
    else setProfile(null);
  }, [status, refresh]);

  if (status !== 'signedIn') {
    return (
      <View style={[styles.root, styles.center, { backgroundColor: colors.bg }]}>
        <Text style={[styles.title, { color: colors.text }]}>Saved</Text>
        <Text style={[styles.body, { color: colors.textMuted }]}>
          Your saved drives, favourites and profile live here once you’re signed in. Browsing and
          planning never need an account.
        </Text>
        <Pressable
          onPress={() => gate(() => undefined)}
          style={[styles.primary, { backgroundColor: colors.accent }]}
          accessibilityRole="button"
          accessibilityLabel="Sign in"
        >
          <Text style={[styles.primaryText, { color: colors.onAccent }]}>Sign in</Text>
        </Pressable>
      </View>
    );
  }

  const submitName = (): void => {
    setBusy(true);
    setProblem(null);
    void (async () => {
      try {
        const token = await freshAccessToken();
        if (!token || !user) throw new DataError('Your session expired — sign in again.', null);
        const next = await saveName(cfg, token, user.id, draft);
        setProfile(next);
        setEditing(false);
      } catch (err) {
        setProblem(err instanceof DataError ? err.message : 'Could not save the name.');
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: colors.bg }]}
      contentContainerStyle={styles.content}
    >
      <Text style={[styles.title, { color: colors.text }]}>{profile?.display_name ?? '…'}</Text>
      <Text style={[styles.body, { color: colors.textMuted }]}>{user?.email}</Text>

      {editing ? (
        <View style={styles.row}>
          <TextInput
            style={[styles.input, { color: colors.text, borderColor: colors.border }]}
            value={draft}
            onChangeText={setDraft}
            maxLength={DISPLAY_NAME_MAX}
            editable={!busy}
            accessibilityLabel="Display name"
          />
          <Pressable
            onPress={submitName}
            disabled={busy}
            style={[styles.primary, { backgroundColor: colors.accent, opacity: busy ? 0.6 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel="Save name"
          >
            {busy ? (
              <ActivityIndicator color={colors.onAccent} />
            ) : (
              <Text style={[styles.primaryText, { color: colors.onAccent }]}>Save</Text>
            )}
          </Pressable>
        </View>
      ) : (
        <Pressable
          onPress={() => {
            setDraft(profile?.display_name ?? '');
            setEditing(true);
          }}
          accessibilityRole="button"
          accessibilityLabel="Edit display name"
        >
          <Text style={[styles.link, { color: colors.accent }]}>Edit display name</Text>
        </Pressable>
      )}

      {problem !== null && (
        <Text style={[styles.problem, { color: colors.danger }]}>{problem}</Text>
      )}

      <View style={[styles.section, { borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Saved drives</Text>
        {drives === null || drives.length === 0 ? (
          <Text style={[styles.body, { color: colors.textMuted }]}>
            No saved drives yet — plan one and tap “Save this drive”.
          </Text>
        ) : (
          drives.map((d) => (
            <View key={d.id} style={[styles.driveRow, { borderColor: colors.border }]}>
              <Text style={[styles.driveName, { color: colors.text }]}>{d.name}</Text>
              <Text style={[styles.body, { color: colors.textMuted }]}>
                {Math.round(d.duration_s / 60)} min · {(d.distance_m / 1000).toFixed(0)} km ·{' '}
                {d.visibility}
              </Text>
            </View>
          ))
        )}
      </View>

      <Pressable
        onPress={() => void signOut()}
        style={styles.signOut}
        accessibilityRole="button"
        accessibilityLabel="Sign out"
      >
        <Text style={[styles.link, { color: colors.textMuted }]}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  content: { padding: spacing.xl, gap: spacing.md },
  title: { ...font.title },
  body: { ...font.body, lineHeight: 21 },
  link: { ...font.body },
  problem: { ...font.caption },
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: HIT_TARGET,
    fontSize: font.body.fontSize,
  },
  primary: {
    minHeight: HIT_TARGET,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { ...font.button },
  section: { borderTopWidth: 1, paddingTop: spacing.md, gap: spacing.xs, marginTop: spacing.md },
  sectionTitle: { ...font.heading },
  driveRow: { borderBottomWidth: 1, paddingVertical: spacing.sm, gap: 2 },
  driveName: { ...font.body, fontWeight: '600' },
  signOut: { minHeight: HIT_TARGET, justifyContent: 'center', marginTop: spacing.lg },
});
