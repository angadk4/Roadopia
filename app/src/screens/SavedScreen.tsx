/**
 * Saved tab — profile + owned content (M8-T02; FR-090/091).
 *
 * Anonymous: an honest explainer + a "Sign in" button that goes through the
 * SAME gate primitive as every gated action (FR-201 — the button's action is
 * simply "load my profile"). Signed in: display name (editable inline, cap
 * mirrored from the DB), email, sign-out, and the saved-drives list.
 *
 * Device pass (2026-09-04): the list loaded ONCE per sign-in and never again,
 * so a drive saved on Result was invisible here until the app restarted —
 * "saved drives aren't saving". It now reloads on tab focus and on pull; a
 * failed load says so instead of posing as "no saved drives yet" (§18); and
 * the initial session read shows a spinner, not the anonymous screen.
 */

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { CONTACT_EMAIL, contactMailtoUrl } from '../lib/contact';
import { DataError } from '../lib/data';
import { useTopInset } from '../lib/insets';
import { deleteAccount, visibilityLabel } from '../lib/library';
import { DISPLAY_NAME_MAX, fetchProfile, updateDisplayName, type Profile } from '../lib/profile';
import { getApiBaseUrl, getSupabaseConfig } from '../lib/runtime';
import { listMyRoutes, type SavedRow } from '../lib/saves';
import { useAuth } from '../lib/use_auth';
import { font, HIT_TARGET, radius, spacing, useTheme } from '../theme';

export interface SavedScreenProps {
  /** Present inside SavedStack; absent in isolated tests. */
  navigation?: {
    navigate: (screen: string, params?: Record<string, unknown>) => void;
    /** Reload the list when the tab regains focus (a save on Result must be
     *  here when the user comes back). */
    addFocusListener?: (cb: () => void) => () => void;
  };
  /** Injectable for tests; defaults to the runtime Supabase config. */
  cfg?: { url: string; anonKey: string };
  fetchProfileFn?: typeof fetchProfile;
  updateNameFn?: typeof updateDisplayName;
  listRoutesFn?: typeof listMyRoutes;
}

type ListPhase = 'loading' | 'ready' | 'error';
type LoadMode = 'initial' | 'focus' | 'pull';

export default function SavedScreen(props: SavedScreenProps): ReactElement {
  const { colors } = useTheme();
  const topInset = useTopInset();
  const { status, user, gate, signOut, freshAccessToken } = useAuth();
  const [dangerArmed, setDangerArmed] = useState(false);
  const [dangerProblem, setDangerProblem] = useState<string | null>(null);

  // Disarm whenever the signed-in identity changes. Without this the armed
  // state outlives the account it was armed for, and the NEXT person to sign in
  // on this device is one tap from deleting theirs.
  useEffect(() => {
    setDangerArmed(false);
    setDangerProblem(null);
  }, [user?.id, status]);

  const destroyAccount = (): void => {
    if (!dangerArmed) {
      setDangerArmed(true); // first tap arms; second tap deletes (FR-207)
      return;
    }
    void (async () => {
      try {
        const token = await freshAccessToken();
        if (!token) throw new DataError('Sign in again first.', null);
        await deleteAccount(getApiBaseUrl(), token);
        setDangerArmed(false); // never leave the next signed-in user one tap away
        await signOut(); // local session is now meaningless
      } catch (err) {
        setDangerProblem(
          err instanceof DataError ? err.message : 'Could not delete the account right now.',
        );
        setDangerArmed(false);
      }
    })();
  };
  const cfg = props.cfg ?? getSupabaseConfig();
  const loadProfile = props.fetchProfileFn ?? fetchProfile;
  const saveName = props.updateNameFn ?? updateDisplayName;
  const loadRoutes = props.listRoutesFn ?? listMyRoutes;

  const [profile, setProfile] = useState<Profile | null>(null);
  const [drives, setDrives] = useState<SavedRow[]>([]);
  const [listPhase, setListPhase] = useState<ListPhase>('loading');
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /** Generation of the LATEST load. A superseded load's results are dropped:
   *  a later focus, pull or sign-in is never swallowed by a stalled one, and
   *  a previous account's rows can never land on the next account's screen
   *  (review finding: a boolean in-flight gate did both). */
  const gen = useRef(0);

  const refresh = useCallback(
    (mode: LoadMode = 'initial'): void => {
      if (!user) return;
      const my = ++gen.current;
      const uid = user.id;
      if (mode === 'pull') setRefreshing(true);
      else if (mode === 'initial') setListPhase('loading');
      loadProfile(cfg, uid)
        .then((p) => {
          if (my !== gen.current) return;
          setProfile(p);
          setProblem(null);
        })
        .catch((err: unknown) => {
          if (my !== gen.current) return;
          setProblem(err instanceof DataError ? err.message : 'Could not load the profile.');
        });
      void (async () => {
        try {
          const token = await freshAccessToken();
          if (my !== gen.current || !token) return; // superseded, or anon again
          const rows = await loadRoutes(cfg, token, uid);
          if (my !== gen.current) return;
          setDrives(rows);
          setListPhase('ready');
        } catch {
          if (my === gen.current) setListPhase('error'); // never "no drives yet" for a failure
        } finally {
          if (my === gen.current) setRefreshing(false);
        }
      })();
    },
    [user?.id], // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    if (status === 'signedIn') refresh('initial');
    else {
      gen.current += 1; // whatever was loading belonged to the previous identity
      setProfile(null);
      setDrives([]);
      setListPhase('loading');
      setRefreshing(false);
    }
  }, [status, refresh]);

  // Reload on tab focus so a drive saved elsewhere is here when the user
  // comes back. The adapter object is rebuilt every render, so it is
  // deliberately NOT a dependency (MapHome precedent).
  useEffect(() => {
    const off = props.navigation?.addFocusListener?.(() => {
      if (status === 'signedIn') refresh('focus');
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, refresh]);

  if (status === 'loading') {
    // The persisted session is still being read: a spinner, never a flash of
    // the anonymous screen at someone who is signed in.
    return (
      <View style={[styles.root, styles.center, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.accent} accessibilityLabel="Loading" />
      </View>
    );
  }

  if (status !== 'signedIn') {
    return (
      <View
        style={[
          styles.root,
          styles.center,
          { backgroundColor: colors.bg, paddingTop: spacing.xl + topInset },
        ]}
      >
        <Text style={[styles.title, { color: colors.text }]}>Saved</Text>
        <Text style={[styles.body, { color: colors.textMuted }]}>
          Your saved drives and profile live here once you’re signed in. Browsing and planning never
          need an account.
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

  const drivesSection = ((): ReactElement => {
    if (listPhase === 'loading') {
      return (
        <View style={styles.row}>
          <ActivityIndicator color={colors.accent} />
          <Text style={[styles.body, { color: colors.textMuted }]}>Loading your drives…</Text>
        </View>
      );
    }
    if (listPhase === 'error') {
      return (
        <>
          <Text style={[styles.body, { color: colors.danger }]}>
            Couldn’t load your drives — check your connection.
          </Text>
          <Pressable
            onPress={() => refresh('initial')}
            style={[styles.secondary, { borderColor: colors.border }]}
            accessibilityRole="button"
            accessibilityLabel="Retry loading drives"
          >
            <Text style={[styles.link, { color: colors.text }]}>Retry</Text>
          </Pressable>
        </>
      );
    }
    if (drives.length === 0) {
      return (
        <Text style={[styles.body, { color: colors.textMuted }]}>
          No saved drives yet — plan one and tap “Save this drive”.
        </Text>
      );
    }
    return (
      <>
        {drives.map((d) => (
          <Pressable
            key={d.id}
            onPress={() =>
              props.navigation?.navigate('SavedRoute', {
                id: d.id,
                name: d.name,
                visibility: d.visibility,
              })
            }
            accessibilityRole="button"
            accessibilityLabel={`Open ${d.name}`}
            style={({ pressed }) => [
              styles.driveRow,
              { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Text style={[styles.driveName, { color: colors.text }]} numberOfLines={1}>
              {d.name}
            </Text>
            <Text style={[styles.body, { color: colors.textMuted }]}>
              {d.is_loop ? 'Loop' : 'A → B'} · {Math.round(d.duration_s / 60)} min ·{' '}
              {(d.distance_m / 1000).toFixed(0)} km · {visibilityLabel(d.visibility)}
            </Text>
          </Pressable>
        ))}
      </>
    );
  })();

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: colors.bg }]}
      contentContainerStyle={[styles.content, { paddingTop: spacing.xl + topInset }]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => refresh('pull')}
          tintColor={colors.accent}
        />
      }
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
          style={styles.inlineLink}
        >
          <Text style={[styles.link, { color: colors.accent }]}>Edit display name</Text>
        </Pressable>
      )}

      {problem !== null && (
        <Text style={[styles.problem, { color: colors.danger }]}>{problem}</Text>
      )}

      <View style={[styles.section, { borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Saved drives</Text>
        {drivesSection}
      </View>

      <Pressable
        onPress={() => void signOut()}
        style={styles.signOut}
        accessibilityRole="button"
        accessibilityLabel="Sign out"
      >
        <Text style={[styles.link, { color: colors.textMuted }]}>Sign out</Text>
      </Pressable>
      {/* M8-T09 data path + M10 UI (FR-207): real deletion, blobs included */}
      <Pressable
        onPress={destroyAccount}
        style={styles.signOut}
        accessibilityRole="button"
        accessibilityLabel="Delete account"
      >
        <Text style={[styles.link, { color: colors.danger }]}>
          {dangerArmed
            ? 'Tap again to permanently delete your account and all saved data'
            : 'Delete account…'}
        </Text>
      </Pressable>
      {dangerProblem !== null && (
        <Text style={[styles.body, { color: colors.danger }]}>{dangerProblem}</Text>
      )}
      {/* M10-T08 (FR-304): contact / abuse path */}
      <Pressable
        onPress={() => {
          // No mail client (common on Android emulators / de-Googled phones)
          // rejects — unhandled, the button would do nothing at all.
          Linking.openURL(contactMailtoUrl('Roadopia — contact/abuse')).catch(() =>
            setDangerProblem(`No mail app to open. Reach us at ${CONTACT_EMAIL}.`),
          );
        }}
        style={styles.signOut}
        accessibilityRole="button"
        accessibilityLabel="Contact or report abuse"
      >
        <Text style={[styles.link, { color: colors.textMuted }]}>Contact & abuse reports</Text>
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
  inlineLink: { minHeight: HIT_TARGET, justifyContent: 'center' },
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
  secondary: {
    minHeight: HIT_TARGET,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  section: { borderTopWidth: 1, paddingTop: spacing.md, gap: spacing.sm, marginTop: spacing.md },
  sectionTitle: { ...font.heading },
  driveRow: { borderBottomWidth: 1, paddingVertical: spacing.sm, gap: 2, minHeight: HIT_TARGET },
  driveName: { ...font.body, fontWeight: '600' },
  signOut: { minHeight: HIT_TARGET, justifyContent: 'center', marginTop: spacing.lg },
});
