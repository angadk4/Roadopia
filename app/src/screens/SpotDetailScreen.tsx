/**
 * Spot detail (M10-T02/T04; FR-030/032/034; spec §15). Fetch is by id through
 * RLS — OSM seeds are visible to everyone and NOT editable (FR-032: the
 * server refuses even if this UI lied); a user spot is visible/editable only
 * to its owner in MVP. Any spot is reportable, signed in or not (T06).
 * Photos join at T05.
 *
 * Device pass (2026-09-04): the row reloads on focus, and a lapsed session
 * re-opens the sign-in sheet with the SAME edit/delete parked instead of a
 * "sign in again" line with nothing to press.
 *
 * Redesign (SPEC "SpotDetail"). The one photo-led page in the app:
 *
 *   - The NAME is the native large title. `params.name` names the header at
 *     once (the stack's `pageOptions`), the loaded row and a successful edit
 *     re-title it through `navigation.setTitle` — the adapter SavedRoute
 *     already uses. The page draws no title of its own (SPEC rule 13).
 *   - The PLATE: an own spot's first processed photo bleeds edge to edge under
 *     the title, 4:3, radius 0, a paper gradient at its foot. Only
 *     `thumb_url` — the server-processed, EXIF-stripped, signed artifact —
 *     ever reaches the `Image` (Hard rule E); the list itself is still
 *     `PhotoUpload`'s, reported up through `onPhotos`, so the upload pipeline
 *     is untouched.
 *   - The KICKER is a `LegendKey` in the spot's own map colour: the teal
 *     viewpoint pin and the page you land on are visibly the same object.
 *   - The HEADER MENU (`ellipsis.circle`): Edit (owner, user-sourced only) ·
 *     Report this · Delete (owner, destructive). The screen owns the actions —
 *     only it knows `editable` and the handlers — and hands the header its
 *     render function through `navigation.setHeaderRight`; a bare render has
 *     no header and therefore no menu. The in-page Edit / Delete controls
 *     STAY with their accessibilityLabels (SPEC rule 15).
 *   - DELETE asks through a native `ConfirmDialog` with a destructive action;
 *     the op runs ONLY from that action. The two-tap "Tap again to delete"
 *     arming and its in-place swap wrapper are gone.
 *   - Reading ↔ editing swaps in place (`entering` / `exiting` on the keyed
 *     blocks, `layout` on what follows, so Report never jumps — expo-animation
 *     §3, layout animations for mount/unmount). No entrance on the plate.
 *
 * Honesty (§18, verbatim): a failed background refresh keeps the loaded spot
 * and says so; "That spot isn't yours to edit."; "Not saved — sign in to edit
 * this spot."; "Not deleted — sign in to delete this spot."; OSM provenance
 * shown; no editing affordance on OSM seeds.
 */

import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { LayoutAnimationConfig } from 'react-native-reanimated';

import PhotoUpload, { type PhotoUploadProps } from '../components/PhotoUpload';
import ReportButton, { type ReportButtonHandle } from '../components/ReportButton';
import {
  Button,
  Chapter,
  ENTER_FADE,
  EXIT,
  Legend,
  LegendKey,
  REFLOW,
  Symbol,
  Text,
} from '../components/ui';
import { ConfirmDialog, EmptyState, HeaderMenu, type MenuAction } from '../components/ui/native';
import { sessionProblem } from '../lib/auth_state';
import { DataError } from '../lib/data';
import { useTabBarHeight } from '../lib/insets';
import type { PhotoRef } from '../lib/photos';
import { getApiBaseUrl, getSupabaseConfig } from '../lib/runtime';
import {
  deleteSpot,
  fetchSpotById,
  parseTags,
  SPOT_DESC_MAX,
  SPOT_NAME_MAX,
  SPOT_TYPES,
  updateSpot,
  type SpotDetail,
} from '../lib/spots';
import { useAuth } from '../lib/use_auth';
import { font, HIT_TARGET, radius, spacing, spotColor, useTheme, withAlpha } from '../theme';

export interface SpotDetailScreenParams {
  id: string;
  /** Names the native header at once, while the row loads. */
  name?: string;
}

export interface SpotDetailScreenProps {
  navigation: {
    goBack: () => void;
    addFocusListener?: (cb: () => void) => () => void;
    /** The native large title is the spot's name; the loaded row and an edit
     *  re-title it. */
    setTitle?: (title: string) => void;
    /** The header's `ellipsis.circle` menu. The screen hands the stack a
     *  render function for `headerRight` (it owns the actions), or `null` to
     *  clear it. Absent in a bare render — so is the menu. */
    setHeaderRight?: (render: (() => ReactElement) | null) => void;
  };
  route: { params?: SpotDetailScreenParams };
  /** Injectable for tests. */
  cfg?: { url: string; anonKey: string };
  fetchFn?: typeof fetchSpotById;
  updateFn?: typeof updateSpot;
  deleteFn?: typeof deleteSpot;
  /** Handed straight to `PhotoUpload` on an own spot (its list/upload/delete
   *  functions), so a test of an OWN spot never reaches a live backend. */
  photoProps?: Pick<PhotoUploadProps, 'listFn' | 'uploadFn' | 'deleteFn' | 'pickFn' | 'baseUrl'>;
}

type Phase = 'loading' | 'ready' | 'gone' | 'error';

/** The plain label the app already publishes for a type — never the raw enum.
 *  A type the client does not know still reads as words, not as `great_road`. */
function typeLabel(type: string): string {
  return SPOT_TYPES.find((t) => t.type === type)?.label ?? type.replace(/_/g, ' ');
}

/** The header's title. The name is required at creation, but a row is data:
 *  an empty one gets the same honest fallback the in-page title had, never an
 *  empty header. */
function titleOf(name: string): string {
  return name.trim() === '' ? 'Unnamed spot' : name;
}

/** The plate's proportions: a photograph, not a banner. */
const PLATE_ASPECT = 4 / 3;
/** How far up the plate the paper gradient reaches. */
const PLATE_FOOT = '45%';

export default function SpotDetailScreen(props: SpotDetailScreenProps): ReactElement {
  const { colors } = useTheme();
  const { freshAccessToken, user, gate } = useAuth();
  const tabBarHeight = useTabBarHeight();
  const cfg = props.cfg ?? getSupabaseConfig();
  const load = props.fetchFn ?? fetchSpotById;
  const update = props.updateFn ?? updateSpot;
  const remove = props.deleteFn ?? deleteSpot;
  const params = props.route.params;
  const { setTitle, setHeaderRight } = props.navigation;

  const [spot, setSpot] = useState<SpotDetail | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [busy, setBusy] = useState(false);
  /** Deleting a spot takes its photos with it — the native dialog is the
   *  deliberate second step; the op runs only from its destructive action. */
  const [confirming, setConfirming] = useState(false);
  /** An edit or delete that did not go through. */
  const [problem, setProblem] = useState<string | null>(null);
  /** A background refresh that failed — said above the loaded content, which
   *  stays exactly as it was. */
  const [refreshProblem, setRefreshProblem] = useState<string | null>(null);
  /** The processed photo list, reported up by `PhotoUpload` — the plate is
   *  its first `thumb_url` (Hard rule E). */
  const [photos, setPhotos] = useState<PhotoRef[]>([]);

  const scrollRef = useRef<ScrollView>(null);
  const reportRef = useRef<ReportButtonHandle>(null);

  const refresh = useCallback((): void => {
    if (!params?.id) {
      setPhase('gone');
      return;
    }
    void (async () => {
      try {
        const token = await freshAccessToken();
        const s = await load(cfg, params.id, token);
        if (s === null) {
          // a 404 on the FIRST load is real; on a background refresh of a
          // loaded spot (a lapsed session hiding an own row) keep what is shown
          setPhase((p) => (p === 'ready' ? p : 'gone'));
          return;
        }
        setSpot(s);
        setTitle?.(titleOf(s.name));
        // never clobber an edit in progress with a background reload
        setName((n) => (n === '' ? s.name : n));
        setDescription((d) => (d === '' ? s.description : d));
        setTagsText((t) => (t === '' ? s.tags.join(', ') : t));
        setPhase('ready');
      } catch {
        // a refresh that fails must not replace a spot that is on screen with
        // an error page (review finding) — say it failed, keep what loaded
        setPhase((p) => (p === 'ready' ? p : 'error'));
        setRefreshProblem((q) => q ?? 'Couldn’t refresh this spot — showing what was loaded.');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params?.id]);

  useEffect(refresh, [refresh]);

  useEffect(() => {
    const off = props.navigation.addFocusListener?.(refresh);
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  const mine = spot !== null && spot.owner_id !== null && spot.owner_id === user?.id;
  const editable = mine && spot?.source === 'user'; // FR-032/034

  const startEditing = useCallback((): void => {
    if (spot === null) return;
    setName(spot.name);
    setDescription(spot.description);
    setTagsText(spot.tags.join(', '));
    setEditing(true);
  }, [spot]);

  /** The header menu's "Report this": opens the form at the foot of the page
   *  and brings it into view once it has mounted. */
  const openReport = useCallback((): void => {
    reportRef.current?.open();
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 0);
  }, []);

  const askDelete = useCallback((): void => {
    if (!busy) setConfirming(true);
  }, [busy]);

  // The header's ellipsis menu: the screen builds the actions (only it knows
  // `editable` and the handlers) and hands the stack a render function. Cleared
  // when the page is not ready and on unmount.
  useEffect(() => {
    if (setHeaderRight === undefined) return;
    if (phase !== 'ready' || spot === null) {
      setHeaderRight(null);
      return;
    }
    const actions: MenuAction[] = [];
    if (editable && !editing) {
      actions.push({
        title: 'Edit',
        symbol: 'pencil',
        accessibilityLabel: 'Edit spot',
        onPress: startEditing,
      });
    }
    actions.push({
      title: 'Report this',
      symbol: 'flag',
      accessibilityLabel: 'Report this content',
      onPress: openReport,
    });
    if (editable) {
      actions.push({
        title: 'Delete',
        role: 'destructive',
        symbol: 'trash',
        accessibilityLabel: 'Delete spot',
        onPress: askDelete,
      });
    }
    setHeaderRight(() => <HeaderMenu actions={actions} />);
    return () => setHeaderRight(null);
  }, [setHeaderRight, phase, spot, editable, editing, startEditing, openReport, askDelete]);

  if (phase === 'loading') {
    return (
      <View style={[styles.centre, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (phase !== 'ready' || spot === null) {
    // The dead ends are the platform's own "content unavailable" shape, under
    // the same header; Retry keeps its handler and its label.
    return (
      <ScrollView
        style={{ backgroundColor: colors.bg }}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.deadEnd, { paddingBottom: tabBarHeight + spacing.xl }]}
      >
        <EmptyState
          symbol={phase === 'gone' ? 'questionmarkCircle' : 'wifiSlash'}
          title={
            phase === 'gone'
              ? 'That spot isn’t available — it may have been removed.'
              : 'Could not load that spot right now.'
          }
          {...(phase === 'error'
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

  const tint = spotColor(spot.type);
  const plate = editable ? (photos[0]?.thumb_url ?? null) : null;

  const saveEdits = (): void => {
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
      if (!token) {
        setBusy(false);
        gate(saveEdits, { onDismiss: () => setProblem('Not saved — sign in to edit this spot.') });
        return;
      }
      try {
        const changed = await update(cfg, token, spot.id, {
          name,
          description,
          tags: parseTags(tagsText),
        });
        if (!changed) throw new DataError('That spot isn’t yours to edit.', null);
        const saved = name.trim();
        setSpot({ ...spot, name: saved, description, tags: parseTags(tagsText) });
        setTitle?.(titleOf(saved));
        setEditing(false);
      } catch (err) {
        setProblem(err instanceof DataError ? err.message : 'Could not save the changes.');
      } finally {
        setBusy(false);
      }
    })();
  };

  /** Runs ONLY from the dialog's destructive action (and from the sign-in
   *  gate re-running the same parked delete). */
  const doDelete = (): void => {
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
      if (!token) {
        setBusy(false);
        gate(doDelete, {
          onDismiss: () => setProblem('Not deleted — sign in to delete this spot.'),
        });
        return;
      }
      try {
        await remove(getApiBaseUrl(), token, spot.id);
        props.navigation.goBack();
      } catch (err) {
        setProblem(err instanceof DataError ? err.message : 'Could not delete the spot.');
        setBusy(false);
      }
    })();
  };

  const cancelEditing = (): void => {
    // reseed from the saved row — leaving the drafts in place made "Cancel"
    // a lie: the next Edit → Save wrote the abandoned text
    setName(spot.name);
    setDescription(spot.description);
    setTagsText(spot.tags.join(', '));
    setProblem(null);
    setEditing(false);
  };

  const inputStyle = [
    styles.input,
    { color: colors.text, borderColor: colors.borderStrong, backgroundColor: colors.fill },
  ];

  return (
    <ScrollView
      ref={scrollRef}
      style={{ backgroundColor: colors.bg }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingBottom: tabBarHeight + spacing.xxl }}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
    >
      {/* The plate — only a processed, signed thumbnail ever gets here. */}
      {plate !== null && (
        <View style={styles.plate}>
          <Image
            source={{ uri: plate }}
            resizeMode="cover"
            style={[styles.plateImage, { backgroundColor: colors.fill }]}
            accessibilityLabel="Spot photo"
          />
          <LinearGradient
            pointerEvents="none"
            colors={[withAlpha(colors.bg, 0), withAlpha(colors.bg, 0.6)]}
            style={styles.plateFoot}
          />
          <View
            pointerEvents="none"
            style={[styles.plateOutline, { borderColor: withAlpha(colors.text, 0.1) }]}
          />
        </View>
      )}

      <Animated.View layout={REFLOW} style={styles.column}>
        {refreshProblem !== null && (
          <Text variant="footnote" tone="danger">
            {refreshProblem}
          </Text>
        )}

        {/* The kicker carries the pin's own colour, so the page you land on
            after tapping a marker is recognisably the same object. */}
        <View style={styles.kicker}>
          <LegendKey color={tint}>{typeLabel(spot.type)}</LegendKey>
          {spot.source === 'osm' && <Legend>from OpenStreetMap</Legend>}
        </View>

        {spot.description.length > 0 && <Text variant="body">{spot.description}</Text>}
        {spot.tags.length > 0 && (
          <View style={styles.tagRow}>
            {spot.tags.map((t) => (
              <View key={t} style={[styles.tag, { backgroundColor: colors.fill }]}>
                <Legend>{t}</Legend>
              </View>
            ))}
          </View>
        )}

        {editable && (
          <Chapter title="Your spot">
            {/* `skipEntering`: the block that is there on first paint does not
                fade in; only a swap animates. */}
            <LayoutAnimationConfig skipEntering>
              {editing ? (
                <Animated.View
                  key="editing"
                  entering={ENTER_FADE}
                  exiting={EXIT}
                  style={styles.editForm}
                >
                  <TextInput
                    accessibilityLabel="Spot name"
                    value={name}
                    onChangeText={(t) => setName(t.slice(0, SPOT_NAME_MAX))}
                    style={inputStyle}
                  />
                  <TextInput
                    accessibilityLabel="Spot description"
                    value={description}
                    onChangeText={(t) => setDescription(t.slice(0, SPOT_DESC_MAX))}
                    maxLength={SPOT_DESC_MAX}
                    multiline
                    placeholder="What makes it worth stopping?"
                    placeholderTextColor={colors.textMuted}
                    style={[...inputStyle, styles.multiline]}
                  />
                  <TextInput
                    accessibilityLabel="Spot tags"
                    value={tagsText}
                    onChangeText={setTagsText}
                    autoCapitalize="none"
                    placeholder="Tags, comma-separated"
                    placeholderTextColor={colors.textMuted}
                    style={inputStyle}
                  />
                  <View style={styles.row}>
                    <Button
                      title={busy ? 'Saving…' : 'Save changes'}
                      accessibilityLabel="Save changes"
                      disabled={busy}
                      onPress={saveEdits}
                    />
                    <Button
                      title="Cancel"
                      variant="secondary"
                      accessibilityLabel="Cancel editing"
                      onPress={cancelEditing}
                    />
                  </View>
                </Animated.View>
              ) : (
                <Animated.View
                  key="reading"
                  entering={ENTER_FADE}
                  exiting={EXIT}
                  style={styles.row}
                >
                  <Button
                    title="Edit"
                    variant="secondary"
                    accessibilityLabel="Edit spot"
                    icon={<Symbol name="pencil" size="sm" />}
                    onPress={startEditing}
                  />
                  {/* The in-page control stays (a bare render has no header);
                      it presents the same dialog the header menu does. */}
                  <Button
                    title={busy ? 'Deleting…' : 'Delete'}
                    variant="danger"
                    accessibilityLabel="Delete spot"
                    icon={<Symbol name="trash" size="sm" tone="danger" />}
                    disabled={busy}
                    onPress={askDelete}
                  />
                </Animated.View>
              )}
            </LayoutAnimationConfig>
          </Chapter>
        )}

        {problem !== null && (
          <Animated.View layout={REFLOW}>
            <Text variant="footnote" tone="danger">
              {problem}
            </Text>
          </Animated.View>
        )}

        {/* M10-T05: photos on OWN spots — processed server-side before display */}
        {editable && (
          <Animated.View layout={REFLOW}>
            <Chapter title="Photos">
              <PhotoUpload spotId={spot.id} onPhotos={setPhotos} {...props.photoProps} />
            </Chapter>
          </Animated.View>
        )}

        <Animated.View layout={REFLOW} style={styles.foot}>
          <ReportButton ref={reportRef} targetType="spot" targetId={spot.id} />
        </Animated.View>

        <ConfirmDialog
          isPresented={confirming}
          onIsPresentedChange={setConfirming}
          title="Delete this spot?"
          message="Its photos go with it."
          actions={[
            {
              title: 'Delete',
              role: 'destructive',
              accessibilityLabel: 'Confirm delete spot',
              onPress: doDelete,
            },
            { title: 'Cancel', role: 'cancel', onPress: () => undefined },
          ]}
        />
      </Animated.View>
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
  /** Edge to edge, radius 0: a plate, not a card. */
  plate: { width: '100%', aspectRatio: PLATE_ASPECT },
  plateImage: { width: '100%', height: '100%' },
  plateFoot: { position: 'absolute', left: 0, right: 0, bottom: 0, height: PLATE_FOOT },
  plateOutline: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderWidth: 1,
  },
  column: {
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.lg,
    gap: spacing.md,
  },
  kicker: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.md },
  editForm: { gap: spacing.md },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tag: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  row: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  foot: { marginTop: spacing.xl },
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: HIT_TARGET,
    ...font.body,
  },
  multiline: { minHeight: HIT_TARGET * 2, textAlignVertical: 'top' },
});
