/**
 * A saved drive, reopened (M8-T04/T08; FR-074 — the SAME RouteDetail component
 * renders Result, saved routes and shared-link routes; §16 cohesion rule 1).
 *
 * Owner controls live here rather than in the list: rename, visibility (T08)
 * and delete. Fetch is by id through RLS — a row that isn't yours (or was
 * deleted) comes back null and gets an honest state, never a crash or a blank
 * screen. Device pass (2026-09-04): rename and delete now EXIST (the header
 * comment used to claim delete while no code path did it); the header shows
 * the drive's name; the row reloads on focus; a lapsed session re-gates the
 * same action instead of a dead "sign in again" line.
 *
 * REDESIGN (SPEC "SavedRoute"; rules 13–15). The same page under a collapsing
 * large title, in the plate composition:
 *
 *   - The NAME is the native large title (`params.name` at once through the
 *     stack's `pageOptions`; the loaded row and a rename re-title it through
 *     `navigation.setTitle`). RouteDetail no longer draws it, so the NAME
 *     chapter keeps it on the page in `body` beside Rename — the name stays
 *     visible in a bare render. The first child is the ScrollView the title
 *     collapses over (`contentInsetAdjustmentBehavior="automatic"`); no
 *     horizontal padding, because RouteDetail owns the gutter so its plate can
 *     bleed to both edges.
 *   - FOLLOW rides in RouteDetail's `hero` slot — directly under the numbers,
 *     the "GO" position — as the ONE solid amber on the page. `reveal` stays
 *     off: a library item is already there.
 *   - The HEADER MENU (`ellipsis.circle`): Rename (opens the in-page field) ·
 *     Delete drive (destructive; opens the same dialog). The screen owns the
 *     actions and hands the stack a render function through
 *     `navigation.setHeaderRight`; a bare render has no header and no menu.
 *     The in-page Rename / Delete controls STAY with their labels (rule 15).
 *   - VISIBILITY is the platform's segmented control (`SegmentedPicker` ← the
 *     three chips): one-of-three, short labels, the announced name still
 *     carries the verb ("Set visibility unlisted"). A REFUSED change reverts
 *     the picker's `selectedIndex` — the honest "refused" signal is the
 *     platform control snapping back — and the blurb returns with it.
 *   - DELETE asks through a native `ConfirmDialog` with a destructive action;
 *     the op runs ONLY from that action. The two-tap "Tap again to delete"
 *     arming and its swap wrapper are gone.
 *   - The dead ends are the platform's `EmptyState`; `signed_out` stays
 *     distinct from `gone`.
 *
 * Motion (expo-animation gate). The blurb swap is tens-a-day → an opacity-only
 * `entering` (the shell's `ENTER_FADE`) keyed on the visibility, and none on
 * first paint (`LayoutAnimationConfig skipEntering`); the owner card reflows
 * (`layout={REFLOW}`) when the rename field opens. Haptics: the picker's own
 * `selectionAsync` on a tick; the dialog's `impactAsync(Medium)` on the
 * destructive confirm. Nothing else.
 */

import type { Route } from '@shared/types';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { LayoutAnimationConfig } from 'react-native-reanimated';

import HandoffSection from '../components/HandoffSection';
import RouteDetail from '../components/RouteDetail';
import SafetyNote from '../components/SafetyNote';
import {
  Button,
  Chapter,
  ENTER_FADE,
  Legend,
  REFLOW,
  Row,
  Rule,
  Surface,
  Symbol,
  Text,
} from '../components/ui';
import {
  ConfirmDialog,
  EmptyState,
  HeaderMenu,
  SegmentedPicker,
  type MenuAction,
} from '../components/ui/native';
import { sessionProblem } from '../lib/auth_state';
import { DataError } from '../lib/data';
import { useTabBarHeight } from '../lib/insets';
import {
  deleteRoute,
  fetchRouteById,
  renameRoute,
  ROUTE_NAME_MAX,
  updateVisibility,
  visibilityLabel,
} from '../lib/library';
import { getSupabaseConfig } from '../lib/runtime';
import { useAuth } from '../lib/use_auth';
import { font, HIT_TARGET, radius, spacing, useTheme } from '../theme';

export interface SavedRouteScreenParams {
  id: string;
  /** Shown while the full row loads, so the screen is never blank. */
  name?: string;
  visibility?: string;
}

export interface SavedRouteScreenProps {
  navigation: {
    goBack: () => void;
    navigate: (screen: string, params?: Record<string, unknown>) => void;
    addFocusListener?: (cb: () => void) => () => void;
    /** The native header shows the drive's name; a rename updates it. */
    setTitle?: (title: string) => void;
    /** The header's `ellipsis.circle` menu. The screen hands the stack a
     *  render function for `headerRight` (it owns the actions), or `null` to
     *  clear it. Absent in a bare render — so is the menu. */
    setHeaderRight?: (render: (() => ReactElement) | null) => void;
  };
  route: { params?: SavedRouteScreenParams };
  cfg?: { url: string; anonKey: string };
  fetchRouteFn?: typeof fetchRouteById;
  setVisibilityFn?: typeof updateVisibility;
  renameFn?: typeof renameRoute;
  deleteFn?: typeof deleteRoute;
}

const VISIBILITIES = ['private', 'unlisted', 'public'] as const;
type Vis = (typeof VISIBILITIES)[number];
/** The segment labels — plain words, never the enum. */
const VISIBILITY_OPTIONS = VISIBILITIES.map((v) => visibilityLabel(v));

/** Plain words for each choice — no jargon, no false promises (§18). */
export function visibilityBlurb(v: Vis): string {
  if (v === 'private') return 'Only you can see this drive.';
  if (v === 'unlisted') return 'Anyone with the link can open it. It never shows up in browse.';
  return 'Anyone can find and open this drive.';
}

export default function SavedRouteScreen(props: SavedRouteScreenProps): ReactElement {
  const { colors } = useTheme();
  const { freshAccessToken, gate, status } = useAuth();
  const tabBarHeight = useTabBarHeight();
  const params = props.route.params;
  const cfg = props.cfg ?? getSupabaseConfig();
  const load = props.fetchRouteFn ?? fetchRouteById;
  const setVis = props.setVisibilityFn ?? updateVisibility;
  const rename = props.renameFn ?? renameRoute;
  const remove = props.deleteFn ?? deleteRoute;
  const { setTitle, setHeaderRight } = props.navigation;

  const [route, setRoute] = useState<Route | null>(null);
  const [visibility, setVisState] = useState<Vis>((params?.visibility as Vis) ?? 'private');
  /** 'signed_out': the row came back empty with NO token — the session lapsed,
   *  the drive was not deleted (review finding: it read "may have been deleted"). */
  const [state, setState] = useState<'loading' | 'ready' | 'gone' | 'signed_out' | 'error'>(
    'loading',
  );
  const [problem, setProblem] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  /** A rename is saving. */
  const [busy, setBusy] = useState(false);
  /** The delete is running — "Deleting…" on the row, nothing pressable. */
  const [deleting, setDeleting] = useState(false);
  /** Deleting takes the drive with it — the native dialog is the deliberate
   *  second step; the op runs only from its destructive action. */
  const [confirming, setConfirming] = useState(false);

  /** Generation of the latest load: mount + the first focus both fire one,
   *  and a rename/visibility change invalidates whatever is still loading —
   *  a late GET must never overwrite an edit the user just saw succeed. */
  const gen = useRef(0);

  const refresh = useCallback((): void => {
    if (!params?.id) return;
    // the session is still being read: a null token now would mean nothing
    // (and would read as "session expired" to a signed-in user); the status
    // change re-runs this
    if (status === 'loading') return;
    const my = ++gen.current;
    void (async () => {
      try {
        const token = await freshAccessToken();
        // the read still runs without a token: a public / link-only drive of
        // the owner's opens read-only even when the session has lapsed
        const r = await load(cfg, params.id, token);
        if (my !== gen.current) return; // superseded
        if (r === null) {
          setState(token === null ? 'signed_out' : 'gone');
          return;
        }
        setRoute(r);
        if (r.visibility) setVisState(r.visibility as Vis);
        if (r.name) setTitle?.(r.name);
        setState('ready');
      } catch {
        if (my === gen.current) setState('error');
      }
    })();
  }, [params?.id, status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(refresh, [refresh]);

  useEffect(() => {
    const off = props.navigation.addFocusListener?.(refresh);
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  const notChanged = (): void => setProblem('Not changed — sign in to edit this drive.');

  const choose = (next: Vis): void => {
    const previous = visibility;
    setVisState(next); // optimistic; reverted below if the server disagrees
    setProblem(null);
    void (async () => {
      let token: string | null;
      try {
        token = await freshAccessToken();
      } catch (err) {
        setVisState(previous);
        setProblem(sessionProblem(err));
        return;
      }
      if (!token || !params?.id) {
        setVisState(previous);
        gate(() => choose(next), { onDismiss: notChanged });
        return;
      }
      try {
        await setVis(cfg, token, params.id, next);
        gen.current += 1; // a load still in flight predates this change
      } catch (err) {
        setVisState(previous);
        setProblem(err instanceof DataError ? err.message : 'Could not change visibility.');
      }
    })();
  };

  const submitRename = (): void => {
    const clean = nameDraft.trim();
    if (clean === '') {
      setProblem('Give the drive a name.');
      return;
    }
    setBusy(true);
    setProblem(null);
    void (async () => {
      let token: string | null;
      try {
        token = await freshAccessToken();
      } catch (err) {
        setBusy(false);
        setProblem(sessionProblem(err));
        return;
      }
      if (!token || !params?.id) {
        setBusy(false);
        gate(submitRename, { onDismiss: notChanged });
        return;
      }
      try {
        const saved = await rename(cfg, token, params.id, clean);
        gen.current += 1; // a load still in flight predates this rename
        setRoute((r) => (r ? { ...r, name: saved } : r));
        setTitle?.(saved);
        setRenaming(false);
      } catch (err) {
        setProblem(err instanceof DataError ? err.message : 'Could not rename the drive.');
      } finally {
        setBusy(false);
      }
    })();
  };

  /** Opens the in-page rename field — from the Rename button and from the
   *  header menu alike. */
  const startRename = useCallback((): void => {
    setNameDraft(route?.name ?? params?.name ?? '');
    setRenaming(true);
  }, [route?.name, params?.name]);

  const askDelete = useCallback((): void => {
    if (!deleting) setConfirming(true);
  }, [deleting]);

  /** Runs ONLY from the dialog's destructive action (and from the sign-in
   *  gate re-running the same parked delete). */
  const doDelete = (): void => {
    setDeleting(true);
    setProblem(null);
    void (async () => {
      let token: string | null;
      try {
        token = await freshAccessToken();
      } catch (err) {
        setDeleting(false);
        setProblem(sessionProblem(err));
        return;
      }
      if (!token || !params?.id) {
        setDeleting(false);
        gate(doDelete, {
          onDismiss: () => setProblem('Not deleted — sign in to delete this drive.'),
        });
        return;
      }
      try {
        await remove(cfg, token, params.id);
        props.navigation.goBack(); // the list reloads on focus and the row is gone
      } catch (err) {
        setProblem(err instanceof DataError ? err.message : 'Could not delete the drive.');
        setDeleting(false);
      }
    })();
  };

  // The header's ellipsis menu: the screen builds the actions (only it owns
  // the handlers) and hands the stack a render function. Cleared when the page
  // is not ready and on unmount. Rename is offered while the field is closed;
  // once it is open, the field itself is the way in.
  useEffect(() => {
    if (setHeaderRight === undefined) return;
    if (state !== 'ready' || route === null) {
      setHeaderRight(null);
      return;
    }
    const actions: MenuAction[] = [];
    if (!renaming) {
      actions.push({
        title: 'Rename',
        symbol: 'pencil',
        accessibilityLabel: 'Rename drive',
        onPress: startRename,
      });
    }
    actions.push({
      title: 'Delete drive',
      role: 'destructive',
      symbol: 'trash',
      accessibilityLabel: 'Delete drive',
      onPress: askDelete,
    });
    setHeaderRight(() => <HeaderMenu actions={actions} />);
    return () => setHeaderRight(null);
  }, [setHeaderRight, state, route, renaming, startRename, askDelete]);

  if (state === 'loading') {
    return (
      <View style={[styles.centre, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (state !== 'ready' || route === null) {
    // The dead ends are the platform's own "content unavailable" shape, under
    // the same header; Sign in / Retry keep their handlers and labels.
    return (
      <ScrollView
        style={{ backgroundColor: colors.bg }}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.deadEnd, { paddingBottom: tabBarHeight + spacing.xl }]}
      >
        <EmptyState
          symbol={
            state === 'signed_out' ? 'lock' : state === 'gone' ? 'questionmarkCircle' : 'wifiSlash'
          }
          title={
            state === 'gone'
              ? 'That drive isn’t available any more — it may have been deleted.'
              : state === 'signed_out'
                ? 'Your session expired — sign in to open this drive.'
                : 'Could not load that drive right now.'
          }
          {...(state === 'signed_out'
            ? {
                action: (
                  <Button
                    title="Sign in"
                    variant="secondary"
                    accessibilityLabel="Sign in"
                    onPress={() => gate(refresh)}
                  />
                ),
              }
            : state === 'error'
              ? {
                  action: (
                    <Button
                      title="Retry"
                      variant="secondary"
                      accessibilityLabel="Retry"
                      onPress={refresh}
                    />
                  ),
                }
              : {})}
        />
      </ScrollView>
    );
  }

  const name = route.name ?? params?.name ?? '';

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      // FIRST CHILD: what the native large title (the drive's name) collapses
      // over. No horizontal padding — RouteDetail owns the gutter.
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingBottom: tabBarHeight + spacing.xl }}
      keyboardShouldPersistTaps="handled"
      // the rename field sits low on the page; without this the keyboard
      // covers it and the Save name row (review finding — ResultScreen's fix)
      automaticallyAdjustKeyboardInsets
    >
      <RouteDetail
        route={route}
        explanation={null}
        done={null}
        hero={
          // M9-T06 (FR-112): saved drives are followable too. The ONE solid
          // amber on this screen, in the "GO" position under the numbers.
          <Button
            title="Follow this drive"
            size="lg"
            block
            accessibilityLabel="Follow this drive"
            icon={<Symbol name="locationNorthLineFill" size="md" tone="onAccent" />}
            onPress={() => props.navigation.navigate('Follow', { route })}
          />
        }
      >
        <Chapter title="This drive">
          {/* the card reflows when the rename field opens; nothing under it jumps */}
          <Animated.View layout={REFLOW}>
            <Surface level="raised" padding="md" style={styles.card}>
              <View style={styles.section}>
                <Legend>Name</Legend>
                {renaming ? (
                  <>
                    <TextInput
                      accessibilityLabel="Drive name"
                      value={nameDraft}
                      onChangeText={(t) => setNameDraft(t.slice(0, ROUTE_NAME_MAX))}
                      maxLength={ROUTE_NAME_MAX}
                      autoFocus
                      editable={!busy}
                      returnKeyType="done"
                      onSubmitEditing={submitRename}
                      style={[
                        styles.input,
                        {
                          color: colors.text,
                          borderColor: colors.borderStrong,
                          backgroundColor: colors.fill,
                        },
                      ]}
                    />
                    <View style={styles.row}>
                      <Button
                        title={busy ? 'Saving…' : 'Save name'}
                        accessibilityLabel="Save name"
                        disabled={busy}
                        onPress={submitRename}
                      />
                      <Button
                        title="Cancel"
                        variant="secondary"
                        accessibilityLabel="Cancel rename"
                        onPress={() => {
                          setRenaming(false);
                          setProblem(null);
                        }}
                      />
                    </View>
                  </>
                ) : (
                  // the name stays ON THE PAGE (the header is the host's, and
                  // a bare render has none)
                  <View style={styles.nameRow}>
                    <Text variant="body" numberOfLines={2} style={styles.flex}>
                      {name}
                    </Text>
                    <Button
                      title="Rename"
                      variant="secondary"
                      accessibilityLabel="Rename drive"
                      icon={<Symbol name="pencil" size="sm" />}
                      onPress={startRename}
                    />
                  </View>
                )}
              </View>

              <Rule />

              <View style={styles.section}>
                <Legend>Who can see this</Legend>
                {/* one of three, so it is the platform's segmented control;
                    the announced name carries the verb because "Link only" on
                    its own does not say what choosing it does */}
                <SegmentedPicker
                  label="Who can see this"
                  options={VISIBILITY_OPTIONS}
                  selectedIndex={Math.max(0, VISIBILITIES.indexOf(visibility))}
                  onChange={(index) => {
                    const next = VISIBILITIES[index];
                    if (next !== undefined) choose(next);
                  }}
                  segmentAccessibilityLabel={(_option, index) =>
                    `Set visibility ${VISIBILITIES[index] ?? ''}`
                  }
                />
                {/* the blurb swaps in place: an opacity-only entrance, none on
                    first paint */}
                <LayoutAnimationConfig skipEntering>
                  <Animated.View key={visibility} entering={ENTER_FADE}>
                    <Text variant="footnote" tone="muted">
                      {visibilityBlurb(visibility)}
                    </Text>
                  </Animated.View>
                </LayoutAnimationConfig>
              </View>
            </Surface>
          </Animated.View>
        </Chapter>

        {problem !== null && (
          <Text variant="footnote" tone="danger">
            {problem}
          </Text>
        )}

        <HandoffSection route={route} />
        <SafetyNote context="route" />

        {/* A DETACHED destructive group. The in-page control stays (a bare
            render has no header); it presents the same dialog the header
            menu does, and the op runs only from the dialog. */}
        <Surface level="inset" padding="none" style={styles.group}>
          <Row
            accessibilityLabel="Delete drive"
            disabled={deleting}
            onPress={askDelete}
            variant="inset"
            leading={<Symbol name="trash" size="md" tone="danger" />}
          >
            <Text variant="label" tone="danger">
              {deleting ? 'Deleting…' : 'Delete drive'}
            </Text>
          </Row>
        </Surface>

        <ConfirmDialog
          isPresented={confirming}
          onIsPresentedChange={setConfirming}
          title={`Delete “${name}”?`}
          message="This can’t be undone."
          actions={[
            {
              title: 'Delete',
              role: 'destructive',
              accessibilityLabel: 'Confirm delete drive',
              onPress: doDelete,
            },
            { title: 'Cancel', role: 'cancel', onPress: () => undefined },
          ]}
        />
      </RouteDetail>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.gutter,
  },
  deadEnd: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.gutter,
  },
  card: { gap: spacing.lg },
  section: { gap: spacing.md },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  flex: { flex: 1 },
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: HIT_TARGET,
    ...font.body,
  },
  group: { overflow: 'hidden' },
});
