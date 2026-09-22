/**
 * The home shelf (redesign — SPEC "The Shelf (what the drives rail / menu
 * becomes)").
 *
 * WHAT IT WAS. Discover's title card + horizontal rail of cards, and MapHome's
 * `MapNotice` banners + `DetailSheet` — five opaque panels floating over the
 * map on two different tabs. WHAT IT IS. One persistent gesture sheet
 * (`ui/Shelf`, a `Material role="sheet"`) over the one map, in three parts:
 *
 *   HEADER (always visible, under the grabber): the mode picker [Near you ·
 *   All roads] — a native segmented control, the platform's own — with the
 *   count legend at its trailing end ("4 DRIVES" / "12 ROADS"), then the
 *   status row when there is one (`ShelfNote`: a leading symbol or an
 *   `ActivityIndicator` for a scan in flight, a 2 pt tinted rule, the sentence
 *   verbatim) and the one control under it (Try again / Retry).
 *
 *   BODY, browsing: a vertical `FlatList` of `DriveCard`s — the Shelf hands
 *   over its scroll props through `renderBody`, so the list IS the sheet's
 *   scroll container and the drag ↔ scroll handoff is the primitive's. The
 *   list's own header carries the Near-you headline and the origin row; its
 *   footer the disclosures. Rows carry no entrance (virtualized — RECIPES);
 *   the container fades in once when a menu lands (`key` on the menu).
 *
 *   BODY, detail: the list crossfades out and, in the same slot, the tapped
 *   thing's detail: a back row (`chevron.left` + the list's legend), the
 *   kicker, the name, the Stat row (omitted when the row carried no figures),
 *   tags, the processed-photo strip for a user pin (thumb_url only — Hard rule
 *   E), and the ONE filled amber action the screen hands in.
 *
 * MOTION GATE. Drag: finger-driven, direct manipulation — the Shelf's own
 * physics, Light at the catch. List ↔ detail: occasional, spatial consistency
 * (the same slot) → opacity-only `entering` / `exiting` on the two content
 * roots (`ENTER_FADE` / `EXIT`; under Reduce Motion the fade that still plays,
 * `ENTER_REDUCED`). The mode picker ticks `selectionAsync` (inside the
 * wrapper). Nothing else here animates.
 */

import { useCallback, useEffect, useRef, type ReactElement, type Ref } from 'react';
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  View,
  type FlatList,
  type ListRenderItemInfo,
} from 'react-native';
import Animated from 'react-native-reanimated';

import type { HomeDetent, HomeMode } from '../lib/home_states';
import { radius, spacing, squircle, useTheme } from '../theme';

import DriveCard, { type DriveCardProps, type DriveCardStat } from './DriveCard';
import {
  Button,
  ENTER_FADE,
  ENTER_REDUCED,
  EXIT,
  Legend,
  LegendKey,
  PressableScale,
  Shelf,
  Stat,
  Symbol,
  Text,
  useReducedMotion,
  type ShelfHandle,
  type SymbolKey,
} from './ui';
import { SegmentedPicker } from './ui/native';
import type { ShelfBodyProps } from './ui/Shelf';

/** The two modes, in picker order. */
const MODES: readonly HomeMode[] = ['nearby', 'allRoads'];
const MODE_LABELS: readonly string[] = ['Near you', 'All roads'];

export interface HomeShelfNote {
  key: string;
  /** The leading glyph; `busy` draws the ActivityIndicator (a scan in flight). */
  symbol: SymbolKey | 'busy';
  tone: 'muted' | 'notice' | 'danger';
  /** A bold first line (the server's rejection headline). */
  headline?: string;
  text: string;
}

export interface HomeShelfAction {
  title: string;
  accessibilityLabel?: string;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  onPress: () => void;
}

export interface HomeShelfItem extends DriveCardProps {
  id: string;
}

export interface HomeShelfList {
  /** Changes when a new menu lands — the container fades in once. */
  key: string;
  items: readonly HomeShelfItem[];
  /** The row whose line was tapped on the map: ringed and scrolled to. */
  selectedId: string | null;
  /** `FlatList`'s list slots take an ELEMENT or a component — never loose
   *  children — so these are typed as what the list can actually be given. */
  header?: ReactElement | null;
  footer?: ReactElement | null;
}

export interface HomeShelfDetail {
  key: string;
  /** The back row's legend — the list it returns to ("All drives" / "All roads"). */
  backLabel: string;
  onBack: () => void;
  kicker?: { color: string; label: string };
  badge?: string;
  name: string;
  stats?: readonly DriveCardStat[];
  legs?: DriveCardProps['legs'];
  figures?: string;
  footnote?: string;
  tags?: readonly string[];
  /** Processed thumbnails only (Hard rule E). */
  photos?: readonly { id: string; thumb_url: string }[];
  /** The one action: filled amber for a drive, secondary for a spot's Details. */
  action?: HomeShelfAction | null;
}

export interface HomeShelfProps {
  ref?: Ref<ShelfHandle>;
  detents: Readonly<Record<HomeDetent, number>>;
  initial: HomeDetent;
  onDetent: (key: HomeDetent) => void;
  /** What the sheet sits above — the tab bar's height. */
  bottom: number;
  mode: HomeMode;
  onMode: (mode: HomeMode) => void;
  /** "4 drives" / "12 roads" in source case (Legend uppercases); null → none. */
  count: string | null;
  notes: readonly HomeShelfNote[];
  /** The one control under the notes. */
  action?: HomeShelfAction | null;
  list: HomeShelfList;
  /** Replaces the list in place while set. */
  detail?: HomeShelfDetail | null;
  testID?: string;
}

/** Thumbnail edge in the detail's photo strip. */
const THUMB = 72;

/**
 * Honest status copy, given the prominence it earns: a leading glyph and a
 * tinted rule make a state read as something the app decided, not a stray
 * caption; the words are never touched. (Discover's `StatusNote`, in the shelf.)
 */
function ShelfNote(props: Omit<HomeShelfNote, 'key'>): ReactElement {
  const { colors } = useTheme();
  const rule =
    props.tone === 'danger'
      ? colors.danger
      : props.tone === 'notice'
        ? colors.notice
        : colors.hairline;
  return (
    <View style={styles.noteRow}>
      <View style={[styles.noteRule, { backgroundColor: rule }]} />
      {props.symbol === 'busy' ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <Symbol name={props.symbol} size="sm" tone={props.tone} />
      )}
      <View style={styles.noteBody}>
        {props.headline !== undefined && <Text variant="bodyStrong">{props.headline}</Text>}
        <Text variant="footnote" tone="muted">
          {props.text}
        </Text>
      </View>
    </View>
  );
}

/** Bring the selected row into view. A list that cannot scroll yet (not laid
 *  out, an index past what is rendered) simply does not — never a crash. */
function scrollListTo(list: FlatList<HomeShelfItem> | null, index: number): void {
  try {
    list?.scrollToIndex({ index, animated: true, viewPosition: 0 });
  } catch {
    // the row is there; the scroll is a courtesy
  }
}

export default function HomeShelf(props: HomeShelfProps): ReactElement {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const enter = reduced ? ENTER_REDUCED : ENTER_FADE;
  const listRef = useRef<FlatList<HomeShelfItem>>(null);

  const { list, detail, onMode } = props;
  const selectedId = list.selectedId;

  // A line tapped on the map brings its card into view (SPEC "Selected row").
  useEffect(() => {
    if (selectedId === null || detail) return;
    const index = list.items.findIndex((it) => it.id === selectedId);
    if (index >= 0) scrollListTo(listRef.current, index);
  }, [selectedId, detail, list.items]);

  const onPick = useCallback(
    (index: number) => {
      const mode = MODES[index];
      if (mode !== undefined) onMode(mode);
    },
    [onMode],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<HomeShelfItem>) => {
      const { id, ...card } = item;
      return <DriveCard {...card} selected={id === selectedId} />;
    },
    [selectedId],
  );

  const header = (
    <View style={styles.header}>
      <View style={styles.modeRow}>
        <SegmentedPicker
          options={MODE_LABELS}
          selectedIndex={Math.max(0, MODES.indexOf(props.mode))}
          onChange={onPick}
          label="Browse"
          style={styles.picker}
        />
        {props.count !== null && <Legend>{props.count}</Legend>}
      </View>
      {props.notes.map(({ key, ...note }) => (
        <ShelfNote key={key} {...note} />
      ))}
      {props.action !== undefined && props.action !== null && (
        <Button
          title={props.action.title}
          {...(props.action.accessibilityLabel !== undefined
            ? { accessibilityLabel: props.action.accessibilityLabel }
            : {})}
          variant={props.action.variant ?? 'secondary'}
          disabled={props.action.disabled ?? false}
          onPress={props.action.onPress}
          style={styles.selfStart}
        />
      )}
    </View>
  );

  const renderBody = (body: ShelfBodyProps): ReactElement => {
    if (detail) {
      const hasStats = detail.stats !== undefined && detail.stats.some((s) => s.value !== null);
      const photos = detail.photos ?? [];
      return (
        <Animated.ScrollView
          key={`detail:${detail.key}`}
          entering={enter}
          exiting={EXIT}
          {...body}
          contentContainerStyle={[body.contentContainerStyle, styles.detailContent]}
        >
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={`Back to ${detail.backLabel}`}
            onPress={detail.onBack}
            style={styles.backRow}
          >
            <Symbol name="chevronLeft" size="sm" tone="accent" />
            <Legend tone="accent">{detail.backLabel}</Legend>
          </PressableScale>

          {detail.kicker !== undefined && (
            <View style={styles.kickerRow}>
              <LegendKey color={detail.kicker.color}>{detail.kicker.label}</LegendKey>
              {detail.badge !== undefined && <Legend tone="accent">{detail.badge}</Legend>}
            </View>
          )}
          <Text variant="title" numberOfLines={3}>
            {detail.name}
          </Text>

          {hasStats && (
            <View style={styles.statRow}>
              {detail.stats!.map((s) => (
                <Stat key={s.label} value={s.value} label={s.label} />
              ))}
            </View>
          )}
          {detail.figures !== undefined && (
            <Text variant="footnote" tone="muted" style={styles.figures}>
              {detail.figures}
            </Text>
          )}
          {detail.footnote !== undefined && (
            <Text variant="footnote" tone="muted" style={styles.figures}>
              {detail.footnote}
            </Text>
          )}

          {photos.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.photoStrip}
              accessibilityLabel={`${photos.length} ${photos.length === 1 ? 'photo' : 'photos'}`}
            >
              {photos.map((ph) => (
                <Image
                  key={ph.id}
                  // thumb_url is a signed URL to the PROCESSED (EXIF-stripped)
                  // artifact — the only kind the app ever renders (Hard rule E)
                  source={{ uri: ph.thumb_url }}
                  style={[styles.photoThumb, { backgroundColor: colors.fill }]}
                  accessibilityIgnoresInvertColors
                />
              ))}
            </ScrollView>
          )}

          {detail.tags !== undefined && detail.tags.length > 0 && (
            <View style={styles.tagRow}>
              {detail.tags.map((t) => (
                <View key={t} style={[styles.tag, { backgroundColor: colors.fill }]}>
                  <Legend>{t.replace('_', ' ')}</Legend>
                </View>
              ))}
            </View>
          )}

          {detail.action !== undefined && detail.action !== null && (
            <Button
              title={detail.action.title}
              {...(detail.action.accessibilityLabel !== undefined
                ? { accessibilityLabel: detail.action.accessibilityLabel }
                : {})}
              variant={detail.action.variant ?? 'primary'}
              block
              disabled={detail.action.disabled ?? false}
              onPress={detail.action.onPress}
            />
          )}
        </Animated.ScrollView>
      );
    }

    return (
      <Animated.FlatList
        key={`list:${list.key}`}
        ref={listRef}
        entering={enter}
        exiting={EXIT}
        {...body}
        contentContainerStyle={[body.contentContainerStyle, styles.listContent]}
        contentInsetAdjustmentBehavior="automatic"
        data={list.items}
        extraData={selectedId}
        keyExtractor={(item: HomeShelfItem) => item.id}
        renderItem={renderItem}
        ListHeaderComponent={list.header ?? null}
        ListFooterComponent={list.footer ?? null}
        onScrollToIndexFailed={(info) =>
          listRef.current?.scrollToOffset({
            offset: info.averageItemLength * info.index,
            animated: true,
          })
        }
      />
    );
  };

  return (
    <Shelf
      {...(props.ref !== undefined ? { ref: props.ref } : {})}
      detents={props.detents}
      initial={props.initial}
      onDetent={(key) => props.onDetent(key as HomeDetent)}
      header={header}
      renderBody={renderBody}
      style={{ bottom: props.bottom }}
      {...(props.testID !== undefined ? { testID: props.testID } : {})}
    />
  );
}

const styles = StyleSheet.create({
  selfStart: { alignSelf: 'flex-start' },
  figures: { fontVariant: ['tabular-nums'] },

  header: { paddingHorizontal: spacing.gutter, paddingBottom: spacing.md, gap: spacing.md },
  modeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  picker: { flex: 1 },

  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  noteRule: { width: 2, alignSelf: 'stretch', borderRadius: 1 },
  noteBody: { flex: 1, gap: spacing.xs },

  listContent: { paddingHorizontal: spacing.gutter, gap: spacing.md },
  detailContent: { paddingHorizontal: spacing.gutter, gap: spacing.md },

  backRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start' },
  kickerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  statRow: { flexDirection: 'row', gap: spacing.xl },
  photoStrip: { flexDirection: 'row', gap: spacing.sm },
  photoThumb: { width: THUMB, height: THUMB, borderRadius: radius.md, ...squircle },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tag: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
});
