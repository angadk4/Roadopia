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
 *
 * REDESIGN (SPEC "SavedHome"; rules 13–15). The page is a large-title
 * `FlatList`, not a headerless scroll with a hand-drawn name as its title:
 *
 *   - The NATIVE large title "Saved" (the stack's `pageOptions`) collapses
 *     into the bar as the list scrolls under it — the FlatList is the first
 *     child, `contentInsetAdjustmentBehavior="automatic"` is what makes that
 *     native. The page draws no title and pads no top inset of its own.
 *   - The PROFILE is the list header: a chapter "YOU" on an index rule (the
 *     display name in `title`, or the skeleton bar — never "…"), then the
 *     chapter "SAVED DRIVES" with the count. The ACCOUNT actions are the list
 *     footer: an inset-grouped pair (Sign out · Contact) and a DETACHED
 *     destructive group (Delete account…) drawn from the app's own `Surface` +
 *     `Row` (the SPEC decided against `@expo/ui` List here).
 *   - Each drive is a virtualised row you can SWIPE to delete: a left swipe
 *     reveals a danger Delete action, which asks through a native
 *     `ConfirmDialog` — the SAME owner op SavedRoute runs (`deleteRoute`), a
 *     second path to it — and the list closes the gap (`itemLayoutAnimation`).
 *     Rows carry no `entering` (rule 10: never on a virtualised row).
 *   - DELETE ACCOUNT asks through a native `ConfirmDialog` with a destructive
 *     action; the op runs ONLY from that action. The two-tap "Tap again to
 *     permanently delete…" arming is gone; "disarm on identity change" is now
 *     "dismiss the dialog on identity change".
 *   - The three list phases and the anonymous page are the platform's own
 *     `EmptyState` (ContentUnavailableView on iOS); the copy is verbatim and a
 *     failure NEVER degrades into "No saved drives yet".
 *
 * THE SWIPE. The SPEC names gesture-handler's `ReanimatedSwipeable`. That
 * component lives at the package subpath
 * `react-native-gesture-handler/ReanimatedSwipeable`, which the test alias
 * for the bare package rewrites onto the stub FILE — the import cannot
 * resolve under vitest ("Cannot find package …/ReanimatedSwipeable"), and the
 * legacy `Swipeable` on the main index is `@deprecated` and built on core
 * `Animated` (rule 10). So the row's swipe is the RECIPES "Swipe to delete a
 * row" gesture on the same primitives the shell's `Shelf` uses:
 * `Gesture.Pan` with a declared horizontal axis (or it steals the list's
 * vertical scroll), `onStart` captures where the row is (a grab mid-spring
 * continues from there, not from 0), `rubberband` past both edges, a single
 * `onEnd` decision by `project(velocityX)` (so a short fast flick opens and a
 * long slow one does not), a spring that inherits the finger's velocity and
 * is clamped at the row's own edges, and exactly one `scheduleOnRN` per
 * gesture — never per frame (rule 11). Reduce Motion: `ReduceMotion.System`
 * on the springs. The revealed action is hidden from assistive tech until the
 * row is open. When the shell aliases the subpath, this wrapper is what
 * `ReanimatedSwipeable` replaces.
 *
 * Haptics (SPEC policy): the ONE `impactAsync(Medium)` for a destructive
 * confirmation is played by `ConfirmDialog` itself the frame the sheet leaves;
 * nothing here fires a second one. Nothing on the swipe, the scroll or the
 * pull-to-refresh (native).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  ActivityIndicator,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import {
  Button,
  Chapter,
  ENTER_FADE,
  Legend,
  LegendKey,
  REFLOW,
  Row,
  Rule,
  Surface,
  Symbol,
  Text,
} from '../components/ui';
import { ConfirmDialog, EmptyState } from '../components/ui/native';
import { CONTACT_EMAIL, contactMailtoUrl } from '../lib/contact';
import { DataError } from '../lib/data';
import { useTabBarHeight } from '../lib/insets';
import { deleteAccount, deleteRoute, visibilityLabel } from '../lib/library';
import { DISPLAY_NAME_MAX, fetchProfile, updateDisplayName, type Profile } from '../lib/profile';
import { getApiBaseUrl, getSupabaseConfig } from '../lib/runtime';
import { listMyRoutes, type SavedRow } from '../lib/saves';
import { project, rubberband } from '../lib/shelf';
import { useAuth } from '../lib/use_auth';
import {
  elevation,
  font,
  HIT_TARGET,
  motion,
  radius,
  spacing,
  squircle,
  useTheme,
  withAlpha,
} from '../theme';

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
  /** The owner op a swiped row's Delete runs — the same one SavedRoute uses. */
  deleteFn?: typeof deleteRoute;
  /** The account deletion (FR-207), injectable so a test can prove it runs
   *  only from the dialog's destructive action. */
  deleteAccountFn?: typeof deleteAccount;
}

type ListPhase = 'loading' | 'ready' | 'error';
type LoadMode = 'initial' | 'focus' | 'pull';

/** Kilometres, honestly: `.toFixed(0)` printed a 400 m drive as "0 km". */
function km(distanceM: number): string {
  const value = distanceM / 1000;
  return value >= 10 ? value.toFixed(0) : value.toFixed(1);
}

/** The test id a row's pan gesture registers (`withTestId`), so a node test
 *  can drive the swipe of one particular drive. */
export function swipeTestId(driveId: string): string {
  return `saved-swipe-${driveId}`;
}

/** The test id on the slot the revealed Delete action sits in, so a node test
 *  can ask whether THAT view is reachable — by finger and by assistive tech —
 *  rather than counting hidden views over a page whose every unlabelled
 *  `Symbol` is also (correctly) hidden. */
export function actionTestId(driveId: string): string {
  return `saved-action-${driveId}`;
}

/** The revealed action's width: one hit target plus a gutter each side. */
const ACTION_W = HIT_TARGET + spacing.gutter * 2;
/** Recognition axis (RECIPES "Swipe to delete a row"): a horizontal intent
 *  activates the pan; a vertical one fails it so the list keeps its scroll.
 *  The same 10pt the shell's Shelf uses on its axis. */
const ACTIVE_OFFSET_X: [number, number] = [-10, 10];
const FAIL_OFFSET_Y: [number, number] = [-10, 10];

/**
 * One drive row you can swipe to the left to reveal Delete. The swipe lives
 * on the UI thread; the only thing that reaches React is the open/closed
 * decision, once per gesture. `pending` is true while the list's dialog is
 * asking about THIS row: when it turns false and the row is still here (the
 * dialog was dismissed), the row springs closed — a programmatic settle, no
 * finger, so no overshoot.
 */
function SwipeRow(props: {
  drive: SavedRow;
  pending: boolean;
  onAction: (drive: SavedRow) => void;
  children: ReactElement;
}): ReactElement {
  const { drive, pending, onAction, children } = props;
  const { colors } = useTheme();
  const x = useSharedValue(0);
  const start = useSharedValue(0);
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);

  const settle = useCallback((isOpen: boolean): void => {
    openRef.current = isOpen;
    setOpen(isOpen);
  }, []);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .withTestId(swipeTestId(drive.id))
        .activeOffsetX(ACTIVE_OFFSET_X)
        .failOffsetY(FAIL_OFFSET_Y)
        .onStart(() => {
          start.set(x.get());
        })
        .onUpdate((e) => {
          // Only leftwards reveals something; past either edge the row
          // follows the finger a little and no further.
          x.set(rubberband(start.get() + e.translationX, -ACTION_W, 0, ACTION_W));
        })
        .onEnd((e) => {
          // Where the flick was GOING decides, not where the finger let go.
          const projected = x.get() + project(e.velocityX);
          const target = projected < -ACTION_W / 2 ? -ACTION_W : 0;
          x.set(
            withSpring(target, {
              ...motion.spring.sheet,
              velocity: e.velocityX,
              // both edges are hard: the row's own frame, the action's edge
              overshootClamping: true,
              reduceMotion: ReduceMotion.System,
            }),
          );
          scheduleOnRN(settle, target !== 0);
        }),
    [drive.id, x, start, settle],
  );

  useEffect(() => {
    if (!pending && openRef.current) {
      x.set(withSpring(0, { ...motion.spring.settle, reduceMotion: ReduceMotion.System }));
      settle(false);
    }
  }, [pending, x, settle]);

  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));

  return (
    <View style={styles.swipeWrap}>
      {/* the action, under the row: reachable — by finger and by VoiceOver —
          only once the row has been swiped open */}
      <View
        testID={actionTestId(drive.id)}
        pointerEvents={open ? 'auto' : 'none'}
        accessibilityElementsHidden={!open}
        importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
        style={[styles.action, { backgroundColor: withAlpha(colors.danger, 0.16) }]}
      >
        <Button
          title="Delete"
          variant="danger"
          accessibilityLabel={`Delete ${drive.name}`}
          icon={<Symbol name="trash" size="sm" tone="danger" />}
          onPress={() => onAction(drive)}
        />
      </View>
      <GestureDetector gesture={pan}>
        <Animated.View style={slide}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}

/** One saved drive: an atlas entry. Tints on press, never scales. */
function DriveRow({ drive, onPress }: { drive: SavedRow; onPress: () => void }): ReactElement {
  const { colors } = useTheme();

  return (
    <Row
      onPress={onPress}
      accessibilityLabel={`Open ${drive.name}`}
      chevron
      variant="inset"
      leading={
        <Symbol
          name={drive.is_loop ? 'arrowTriangle2Circlepath' : 'arrowRight'}
          size="lg"
          tone="accent"
        />
      }
      style={[
        elevation.raised,
        squircle,
        { borderRadius: radius.lg, borderTopWidth: 1, borderTopColor: colors.topEdge },
      ]}
    >
      <Text variant="headline" numberOfLines={1}>
        {drive.name}
      </Text>
      <Text variant="label" tone="muted" numberOfLines={1} style={styles.figures}>
        {Math.round(drive.duration_s / 60)} min · {km(drive.distance_m)} km
      </Text>
      {/* the kicker in the colour the drive is drawn in; plain words for the
          visibility, never the enum */}
      <LegendKey color={colors.accent}>
        {`${drive.is_loop ? 'Loop' : 'A → B'} · ${visibilityLabel(drive.visibility)}`}
      </LegendKey>
    </Row>
  );
}

export default function SavedScreen(props: SavedScreenProps): ReactElement {
  const { colors } = useTheme();
  const tabBarHeight = useTabBarHeight();
  const { status, user, gate, signOut, freshAccessToken } = useAuth();
  /** The account dialog is up. */
  const [confirmingAccount, setConfirmingAccount] = useState(false);
  const [dangerProblem, setDangerProblem] = useState<string | null>(null);
  /** The drive the list's delete dialog is asking about. */
  const [pendingDelete, setPendingDelete] = useState<SavedRow | null>(null);
  /** A row delete that did not go through. */
  const [listProblem, setListProblem] = useState<string | null>(null);

  // Dismiss any open question whenever the signed-in identity changes. A
  // dialog that outlives the account it asked about would put the NEXT
  // person to sign in on this device one tap from deleting theirs.
  useEffect(() => {
    setConfirmingAccount(false);
    setPendingDelete(null);
    setDangerProblem(null);
    setListProblem(null);
  }, [user?.id, status]);

  const cfg = props.cfg ?? getSupabaseConfig();
  const loadProfile = props.fetchProfileFn ?? fetchProfile;
  const saveName = props.updateNameFn ?? updateDisplayName;
  const loadRoutes = props.listRoutesFn ?? listMyRoutes;
  const removeRoute = props.deleteFn ?? deleteRoute;
  const removeAccount = props.deleteAccountFn ?? deleteAccount;

  /** Runs ONLY from the dialog's destructive action (FR-207). */
  const destroyAccount = (): void => {
    void (async () => {
      try {
        const token = await freshAccessToken();
        if (!token) throw new DataError('Sign in again first.', null);
        await removeAccount(getApiBaseUrl(), token);
        await signOut(); // local session is now meaningless
      } catch (err) {
        setDangerProblem(
          err instanceof DataError ? err.message : 'Could not delete the account right now.',
        );
      }
    })();
  };

  /** Runs ONLY from the row dialog's destructive action — the same owner op
   *  SavedRoute runs. The row leaves and the list closes the gap. */
  const destroyDrive = (drive: SavedRow): void => {
    void (async () => {
      try {
        const token = await freshAccessToken();
        if (!token) throw new DataError('Sign in again first.', null);
        await removeRoute(cfg, token, drive.id);
        setDrives((rows) => rows.filter((r) => r.id !== drive.id));
        setListProblem(null);
      } catch (err) {
        setListProblem(err instanceof DataError ? err.message : 'Could not delete the drive.');
      }
    })();
  };

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
      void (async () => {
        try {
          // one token for both reads: the profile is owner-readable now (0032)
          const token = await freshAccessToken();
          if (my !== gen.current || !token) return; // superseded, or anon again
          loadProfile(cfg, uid, token)
            .then((p) => {
              if (my !== gen.current) return;
              setProfile(p);
              setProblem(null);
            })
            .catch((err: unknown) => {
              if (my !== gen.current) return;
              setProblem(err instanceof DataError ? err.message : 'Could not load the profile.');
            });
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
      <ScrollView
        style={[styles.root, { backgroundColor: colors.bg }]}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.deadEnd, { paddingBottom: tabBarHeight + spacing.xl }]}
      >
        <View style={styles.centre}>
          <ActivityIndicator color={colors.accent} accessibilityLabel="Loading" />
        </View>
      </ScrollView>
    );
  }

  if (status !== 'signedIn') {
    // The anonymous page: the platform's own "content unavailable" shape,
    // honest about what an account is for, and the one action that changes it.
    return (
      <ScrollView
        style={[styles.root, { backgroundColor: colors.bg }]}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.deadEnd, { paddingBottom: tabBarHeight + spacing.xl }]}
      >
        <EmptyState
          symbol="bookmark"
          title="Saved"
          description="Your saved drives and profile live here once you’re signed in. Browsing and planning never need an account."
          action={
            <Button
              title="Sign in"
              accessibilityLabel="Sign in"
              onPress={() => gate(() => undefined)}
              block
              size="lg"
            />
          }
        />
      </ScrollView>
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

  // --- the list header: the profile, then the chapter the rows belong to --------
  const header = (
    <View style={styles.header}>
      <Chapter title="You" style={styles.firstChapter}>
        {profile === null ? (
          // A skeleton, not an ellipsis: the name is unknown, and a literal "…"
          // in the name's place is a placeholder pretending to be content.
          <View
            accessibilityLabel="Loading your profile"
            style={[styles.nameSkeleton, { backgroundColor: colors.fill }]}
          />
        ) : (
          <Text variant="title" numberOfLines={1}>
            {profile.display_name}
          </Text>
        )}
        <Text variant="footnote" tone="muted" numberOfLines={1}>
          {user?.email}
        </Text>

        {editing ? (
          <View style={styles.editRow}>
            <TextInput
              style={[
                styles.input,
                {
                  color: colors.text,
                  backgroundColor: colors.fill,
                  borderColor: colors.borderStrong,
                },
              ]}
              value={draft}
              onChangeText={setDraft}
              maxLength={DISPLAY_NAME_MAX}
              editable={!busy}
              accessibilityLabel="Display name"
              returnKeyType="done"
              onSubmitEditing={submitName}
            />
            <Button
              title="Save"
              accessibilityLabel="Save name"
              onPress={submitName}
              disabled={busy}
              loading={busy}
            />
          </View>
        ) : (
          <Button
            title="Edit display name"
            variant="ghost"
            accessibilityLabel="Edit display name"
            icon={<Symbol name="pencil" size="sm" tone="accent" />}
            onPress={() => {
              setDraft(profile?.display_name ?? '');
              setEditing(true);
            }}
            style={styles.selfStart}
          />
        )}

        {problem !== null && (
          <Text variant="footnote" tone="danger">
            {problem}
          </Text>
        )}
      </Chapter>

      <Chapter
        title="Saved drives"
        trailing={
          listPhase === 'ready' && drives.length > 0 ? <Legend>{`${drives.length}`}</Legend> : null
        }
      >
        {listProblem !== null && (
          <Text variant="footnote" tone="danger">
            {listProblem}
          </Text>
        )}
      </Chapter>
    </View>
  );

  // --- the slot the rows would fill, by phase ----------------------------------------
  const emptySlot = ((): ReactElement => {
    if (listPhase === 'loading') {
      return (
        <View style={styles.stateBox}>
          <ActivityIndicator color={colors.accent} />
          <Text variant="footnote" tone="muted">
            Loading your drives…
          </Text>
        </View>
      );
    }
    if (listPhase === 'error') {
      // §18: a failure says what happened and offers the way out. It NEVER
      // degrades into "no saved drives yet" — that was the original bug.
      return (
        <EmptyState
          symbol="wifiSlash"
          title="Couldn’t load your drives — check your connection."
          action={
            <Button
              title="Retry"
              variant="secondary"
              accessibilityLabel="Retry loading drives"
              onPress={() => refresh('initial')}
            />
          }
        />
      );
    }
    return (
      <EmptyState symbol="map" title="No saved drives yet — plan one and tap “Save this drive”." />
    );
  })();

  // --- the list footer: the account, as inset-grouped rows ---------------------------
  const footer = (
    <View style={styles.footer}>
      <Surface level="inset" padding="none" style={styles.group}>
        <Row
          onPress={() => void signOut()}
          accessibilityLabel="Sign out"
          variant="inset"
          leading={<Symbol name="rectanglePortraitAndArrowRight" size="md" tone="muted" />}
        >
          <Text variant="label">Sign out</Text>
        </Row>
        <Rule style={styles.groupRule} />
        {/* M10-T08 (FR-304): contact / abuse path */}
        <Row
          onPress={() => {
            // No mail client (common on Android emulators / de-Googled phones)
            // rejects — unhandled, the button would do nothing at all.
            Linking.openURL(contactMailtoUrl('Roadopia — contact/abuse')).catch(() =>
              setDangerProblem(`No mail app to open. Reach us at ${CONTACT_EMAIL}.`),
            );
          }}
          accessibilityLabel="Contact or report abuse"
          variant="inset"
          leading={<Symbol name="envelope" size="md" tone="muted" />}
        >
          <Text variant="label">Contact & abuse reports</Text>
        </Row>
      </Surface>

      {/* M8-T09 data path + M10 UI (FR-207): real deletion, blobs included.
          A DETACHED group, so permanent destruction is never one
          indistinguishable link among three; the question itself is the
          platform's action sheet. */}
      <Surface level="inset" padding="none" style={styles.group}>
        <Row
          onPress={() => setConfirmingAccount(true)}
          accessibilityLabel="Delete account"
          variant="inset"
          leading={<Symbol name="trash" size="md" tone="danger" />}
        >
          <Text variant="label" tone="danger">
            Delete account…
          </Text>
        </Row>
      </Surface>
      {dangerProblem !== null && (
        <Text variant="footnote" tone="danger">
          {dangerProblem}
        </Text>
      )}
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      {/* FIRST CHILD: the list the native large title collapses over. Rows are
          virtualised, so nothing enters; the list closes the gap a deleted row
          leaves. The CONTAINER fades in once — this tree mounts the moment the
          persisted session finishes being read (the spinner above is a
          different tree), and a refresh, a delete or a phase change never
          remounts it, so the fade cannot replay. */}
      <Animated.FlatList
        entering={ENTER_FADE}
        data={listPhase === 'ready' ? drives : []}
        keyExtractor={(d: SavedRow) => d.id}
        renderItem={({ item }: { item: SavedRow }) => (
          <SwipeRow
            drive={item}
            pending={pendingDelete?.id === item.id}
            onAction={setPendingDelete}
          >
            <DriveRow
              drive={item}
              onPress={() =>
                props.navigation?.navigate('SavedRoute', {
                  id: item.id,
                  name: item.name,
                  visibility: item.visibility,
                })
              }
            />
          </SwipeRow>
        )}
        itemLayoutAnimation={REFLOW}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight + spacing.xl }]}
        scrollIndicatorInsets={{ bottom: tabBarHeight }}
        // the first tap on "Save" used to only dismiss the keyboard (review finding)
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => refresh('pull')}
            tintColor={colors.accent}
          />
        }
        ListHeaderComponent={header}
        ListEmptyComponent={emptySlot}
        ListFooterComponent={footer}
      />

      {/* the row question — one dialog for the list, about whichever row asked */}
      <ConfirmDialog
        isPresented={pendingDelete !== null}
        onIsPresentedChange={(presented) => {
          if (!presented) setPendingDelete(null);
        }}
        title={`Delete “${pendingDelete?.name ?? ''}”?`}
        message="This can’t be undone."
        actions={[
          {
            title: 'Delete',
            role: 'destructive',
            accessibilityLabel: 'Confirm delete drive',
            onPress: () => {
              if (pendingDelete !== null) destroyDrive(pendingDelete);
            },
          },
          { title: 'Cancel', role: 'cancel', onPress: () => undefined },
        ]}
      />

      {/* the account question */}
      <ConfirmDialog
        isPresented={confirmingAccount}
        onIsPresentedChange={setConfirmingAccount}
        title="Permanently delete your account and all saved data?"
        actions={[
          {
            title: 'Delete account',
            role: 'destructive',
            accessibilityLabel: 'Confirm delete account',
            onPress: destroyAccount,
          },
          { title: 'Cancel', role: 'cancel', onPress: () => undefined },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  /** A dead end under the header: centred in the space the inset leaves. */
  deadEnd: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: spacing.gutter },
  centre: { alignItems: 'center' },
  /** `gutter` is the ONE screen-edge padding; the bottom clears the tab bar. */
  content: {
    paddingHorizontal: spacing.gutter,
    gap: spacing.sm,
  },
  header: { paddingBottom: spacing.sm },
  /** The first chapter sits straight under the large title. */
  firstChapter: { marginTop: 0 },
  nameSkeleton: {
    height: font.title.lineHeight,
    width: '62%',
    borderRadius: radius.sm,
  },
  editRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: HIT_TARGET,
    ...font.body,
  },
  stateBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.lg,
  },
  selfStart: { alignSelf: 'flex-start' },
  footer: { gap: spacing.md, paddingTop: spacing.xl },
  group: { overflow: 'hidden' },
  /** Inset from the leading symbol, iOS-grouped-list style. */
  groupRule: { marginLeft: spacing.xxxl },
  /** Measured values line up column-to-column down a hundred-row list. */
  figures: { fontVariant: ['tabular-nums'] },
  /** The row and, under it, the action it slides off. */
  swipeWrap: { borderRadius: radius.lg, ...squircle },
  action: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: ACTION_W,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    ...squircle,
  },
});
