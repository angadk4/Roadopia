/**
 * Photo grid + upload for OWN spots (M10-T05; FR-035/036). Every rendered
 * image is a signed URL to the PROCESSED artifact — the UI has no concept of
 * the raw original (spec §56: nothing unprocessed is ever retrievable). The
 * picker asks for photo-library access only when tapped (§18) and transcodes
 * HEIC to JPEG on pick, matching the pipeline's accepted formats.
 *
 * Device pass (2026-09-04): the button says "Uploading…" (we cannot see the
 * server's processing step, so we do not claim it); the count against the
 * per-spot cap is shown; and a photo over the server's size cap is refused
 * before a long upload, not after it.
 *
 * Redesign (SPEC "PhotoUpload"). The photographs are the content, so they are
 * laid out as one: a THREE-COLUMN SQUARE GRID (a non-scrolling `FlatList` —
 * six is the cap, a grid is the point) instead of a horizontal strip of tiles.
 * Deletion is NATIVE: the corner badge presents a `ConfirmDialog` with a
 * destructive action, and the op runs ONLY from that action (SPEC rule 15) —
 * the armed scrim with its two in-tile choices is gone. A new tile after an
 * upload fades in and the grid reflows to make room; the uploading
 * placeholder pulses on a CSS animation (expo-animation §3: loop → CSS
 * animation), off under Reduce Motion — and it deliberately does NOT show the
 * local picked image, because nothing unprocessed is ever displayed.
 *
 * Hard rule E is untouched: only `thumb_url` — a signed URL to the processed
 * artifact — is ever handed to an <Image>, and there is still no prop or path
 * by which a raw local uri could reach one. The host (SpotDetail's plate) is
 * told the list through `onPhotos` and draws the same `thumb_url`.
 *
 * Haptics (SPEC policy): `notificationAsync(Success)` when the upload
 * resolves; the Medium impact on a confirmed delete is the dialog's own.
 */

import { NotificationFeedbackType, notificationAsync } from 'expo-haptics';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
  Image,
  type LayoutChangeEvent,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, { css } from 'react-native-reanimated';

import { ApiError, NetworkError } from '../lib/api';
import { deletePhoto, listSpotPhotos, uploadSpotPhoto, type PhotoRef } from '../lib/photos';
import { getApiBaseUrl } from '../lib/runtime';
import { useAuth } from '../lib/use_auth';
import { HIT_TARGET, motion, radius, spacing, squircle, useTheme, withAlpha } from '../theme';

import {
  Button,
  CSS_EASE_IN_OUT,
  ENTER_FADE,
  REFLOW,
  Row,
  Symbol,
  Text,
  useReducedMotion,
} from './ui';
import { ConfirmDialog } from './ui/native';

/** Client mirror of backend/src/routes/photos.ts MAX_PHOTOS_PER_SPOT. The
 *  server enforces it inside the insert; this only lets the UI say so first. */
export const MAX_PHOTOS_PER_SPOT = 6;
/** Client mirror of backend/src/images/process.ts MAX_IMAGE_BYTES (10 MB). */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Three across: the widest a square can be and still be a grid on a phone. */
const COLUMNS = 3;
const GAP = spacing.sm;
/** The delete badge. 28 + 2×`spacing.sm` of hitSlop = the 44 pt touch floor. */
const BADGE = HIT_TARGET - spacing.lg;
const BADGE_SLOP = { top: spacing.sm, right: spacing.sm, bottom: spacing.sm, left: spacing.sm };

/** The uploading placeholder's breath: 0.45 ↔ 0.85 over one 2200 ms cycle
 *  (~0.45 Hz — clear of the 0.2 Hz vestibular band). Module scope, so it is
 *  one keyframe rule, not one per render. */
const PULSE = css.keyframes({
  '0%': { opacity: 0.45 },
  '50%': { opacity: 0.85 },
  '100%': { opacity: 0.45 },
});
/** The placeholder's rest opacity under Reduce Motion — the midpoint. */
const PULSE_REST = 0.65;

/** What the picker hands back: the local uri, and its size when the OS says. */
export interface PickedImage {
  uri: string;
  bytes?: number | null;
}

export interface PhotoUploadProps {
  spotId: string;
  /** The processed list, whenever it is known or changes (load, upload,
   *  delete) — the host draws its plate from the first `thumb_url`. */
  onPhotos?: (photos: PhotoRef[]) => void;
  /** Injectable for tests. A bare string is accepted as a uri. */
  pickFn?: () => Promise<PickedImage | string | null>;
  uploadFn?: typeof uploadSpotPhoto;
  listFn?: typeof listSpotPhotos;
  deleteFn?: typeof deletePhoto;
  baseUrl?: string;
}

/** Default picker — imported lazily so node tests never load the native module. */
async function pickImage(): Promise<PickedImage | null> {
  const ImagePicker = await import('expo-image-picker');
  // No permission request: the modern iOS/Android photo pickers hand back one
  // chosen image without library access, and gating on a permission the picker
  // doesn't need turned "Add a photo" into a silent no-op for anyone who had
  // ever tapped Deny.
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: 'images',
    quality: 0.85, // re-encodes on pick (HEIC → JPEG)
    allowsMultipleSelection: false,
  });
  if (result.canceled || result.assets.length === 0) return null;
  const asset = result.assets[0]!;
  return { uri: asset.uri, bytes: asset.fileSize ?? null };
}

type Phase = { kind: 'idle' } | { kind: 'uploading' } | { kind: 'problem'; message: string };

/** One slot in the grid: a processed photo, or the one upload in flight. */
type Cell = { kind: 'photo'; photo: PhotoRef } | { kind: 'uploading' };

/** NetworkError is NOT an ApiError, so an `instanceof ApiError` check threw away
 *  exactly the messages that tell an offline user what to do. */
function problemText(err: unknown, fallback: string): string {
  if (err instanceof ApiError || err instanceof NetworkError) return err.message;
  return fallback;
}

/** The side of one square cell for a grid `width` wide. */
function cellSize(width: number): number {
  return Math.floor((width - GAP * (COLUMNS - 1)) / COLUMNS);
}

/**
 * One photo. Only `thumb_url` reaches the <Image> — the processed, signed
 * artifact (Hard rule E / spec §56). The badge asks; it never deletes.
 * `fresh` = added after the list loaded (an upload), the one tile that fades
 * in — the loaded grid is simply there.
 */
function PhotoCell(props: {
  photo: PhotoRef;
  size: number;
  fresh: boolean;
  onDelete: () => void;
}): ReactElement {
  const { colors } = useTheme();
  return (
    <Animated.View
      {...(props.fresh ? { entering: ENTER_FADE } : {})}
      style={[styles.cell, { width: props.size, height: props.size }]}
    >
      <Image
        source={{ uri: props.photo.thumb_url }}
        style={[styles.thumb, { backgroundColor: colors.fill }]}
        accessibilityLabel="Spot photo"
      />
      {/* A 1 px inset outline so a pale photograph keeps an edge on the page. */}
      <View
        pointerEvents="none"
        style={[styles.outline, { borderColor: withAlpha(colors.text, 0.1) }]}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Delete photo"
        onPress={props.onDelete}
        hitSlop={BADGE_SLOP}
        style={[styles.badge, { backgroundColor: withAlpha(colors.surfaceRaised, 0.88) }]}
      >
        <Symbol name="xmark" size="sm" />
      </Pressable>
    </Animated.View>
  );
}

/**
 * A placeholder while one photo uploads. It says a photo is coming without
 * claiming progress the client cannot observe — no percentage, no ETA — and
 * it deliberately does NOT show the local picked image (Hard rule E).
 */
function UploadingCell({ size }: { size: number }): ReactElement {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  return (
    <Animated.View
      accessibilityLabel="Uploading a photo"
      style={[
        styles.thumb,
        { width: size, height: size, backgroundColor: colors.fill },
        reduced
          ? { opacity: PULSE_REST }
          : {
              animationName: PULSE,
              animationDuration: motion.pulse * 2,
              animationIterationCount: 'infinite',
              animationTimingFunction: CSS_EASE_IN_OUT,
            },
      ]}
    />
  );
}

export default function PhotoUpload(props: PhotoUploadProps): ReactElement {
  const { freshAccessToken, status } = useAuth();
  const { width: windowWidth } = useWindowDimensions();
  const baseUrl = props.baseUrl ?? getApiBaseUrl();
  const pick = props.pickFn ?? pickImage;
  const upload = props.uploadFn ?? uploadSpotPhoto;
  const list = props.listFn ?? listSpotPhotos;
  const remove = props.deleteFn ?? deletePhoto;
  const { onPhotos } = props;

  const [photos, setPhotos] = useState<PhotoRef[]>([]);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  /** The photo whose delete the dialog is asking about. */
  const [confirmId, setConfirmId] = useState<string | null>(null);
  /** Whether the list is KNOWN: the count against the cap is only claimed
   *  once the list actually loaded (review finding: "0 of 6" after a failed
   *  load was a number the component never measured). */
  const [listState, setListState] = useState<'loading' | 'ok' | 'failed'>('loading');
  const [listAttempt, setListAttempt] = useState(0);
  /** The grid's measured width; the window's until the first layout. */
  const [gridWidth, setGridWidth] = useState(0);
  /** Ids that arrived with the list — everything else is an upload's tile. */
  const loadedIds = useRef<ReadonlySet<string>>(new Set());

  // Keyed on the auth status too: mounted during the initial session read,
  // the first attempt finds no token and must run again once it is known.
  useEffect(() => {
    if (status !== 'signedIn') return;
    let live = true;
    void (async () => {
      try {
        const token = await freshAccessToken();
        if (!token) return;
        const rows = await list({ baseUrl, accessToken: token }, props.spotId);
        if (!live) return;
        loadedIds.current = new Set(rows.map((r) => r.id));
        setPhotos(rows);
        setListState('ok');
      } catch {
        // photo list failing is enrichment loss, not a broken screen (§18) —
        // but it is SAID, and no count is claimed
        if (live) setListState('failed');
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.spotId, status, listAttempt]);

  // The host learns the processed list only once it is known — never a guess.
  useEffect(() => {
    if (listState === 'ok') onPhotos?.(photos);
  }, [photos, listState, onPhotos]);

  const full = listState === 'ok' && photos.length >= MAX_PHOTOS_PER_SPOT;

  const add = (): void => {
    if (phase.kind === 'uploading') return; // two quick taps opened two pickers
    if (full) {
      setPhase({
        kind: 'problem',
        message: `That's the most photos a spot can have (${MAX_PHOTOS_PER_SPOT}). Delete one to add another.`,
      });
      return;
    }
    void (async () => {
      let picked: PickedImage | string | null;
      try {
        picked = await pick();
      } catch {
        setPhase({
          kind: 'problem',
          message: 'Could not open your photos — check photo access in Settings.',
        });
        return;
      }
      if (picked === null) return; // cancelled — not an error
      const image: PickedImage = typeof picked === 'string' ? { uri: picked } : picked;
      if (typeof image.bytes === 'number' && image.bytes > MAX_IMAGE_BYTES) {
        // said BEFORE a 10 MB upload the server would refuse at the end
        setPhase({
          kind: 'problem',
          message: 'That photo is over 10 MB — pick a smaller one, or a screenshot of it.',
        });
        return;
      }
      try {
        setPhase({ kind: 'uploading' });
        const token = await freshAccessToken();
        if (!token)
          throw new ApiError({
            status: 401,
            code: 'auth',
            message: 'Sign in again to add photos.',
          });
        const ref = await upload({ baseUrl, accessToken: token }, props.spotId, image.uri);
        setPhotos((p) => [...p, ref]);
        setPhase({ kind: 'idle' });
        // the tile lands the same frame — one haptic for the outcome
        void notificationAsync(NotificationFeedbackType.Success);
      } catch (err) {
        setPhase({ kind: 'problem', message: problemText(err, 'Could not upload the photo.') });
      }
    })();
  };

  /** Runs ONLY from the dialog's destructive action (SPEC rule 15). */
  const removeOne = (id: string): void => {
    void (async () => {
      try {
        const token = await freshAccessToken();
        if (!token)
          throw new ApiError({ status: 401, code: 'auth', message: 'Sign in again first.' });
        await remove({ baseUrl, accessToken: token }, id);
        setPhotos((p) => p.filter((x) => x.id !== id));
      } catch (err) {
        setPhase({ kind: 'problem', message: problemText(err, 'Could not delete the photo.') });
      }
    })();
  };

  const uploading = phase.kind === 'uploading';
  const size = cellSize(gridWidth > 0 ? gridWidth : windowWidth - spacing.gutter * 2);
  const cells: Cell[] = [
    ...photos.map((photo): Cell => ({ kind: 'photo', photo })),
    ...(uploading ? [{ kind: 'uploading' } as const] : []),
  ];
  const asking = confirmId;

  return (
    <View
      style={styles.wrap}
      onLayout={(e: LayoutChangeEvent) => setGridWidth(e.nativeEvent.layout.width)}
    >
      {cells.length > 0 && (
        <Animated.FlatList
          data={cells}
          keyExtractor={(c) => (c.kind === 'photo' ? c.photo.id : 'uploading')}
          numColumns={COLUMNS}
          scrollEnabled={false}
          itemLayoutAnimation={REFLOW}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={styles.grid}
          renderItem={({ item }) =>
            item.kind === 'photo' ? (
              <PhotoCell
                photo={item.photo}
                size={size}
                fresh={!loadedIds.current.has(item.photo.id)}
                onDelete={() => setConfirmId(item.photo.id)}
              />
            ) : (
              <UploadingCell size={size} />
            )
          }
        />
      )}
      {phase.kind === 'problem' && (
        <View style={styles.messageRow}>
          <Symbol name="xmarkCircleFill" size="md" tone="danger" />
          <Text variant="footnote" tone="danger" style={styles.flex}>
            {phase.message}
          </Text>
        </View>
      )}
      {listState === 'failed' && (
        <Row
          accessibilityLabel="Retry loading photos"
          onPress={() => {
            setListState('loading');
            setListAttempt((a) => a + 1);
          }}
          leading={<Symbol name="arrowClockwise" size="md" tone="muted" />}
        >
          <Text variant="footnote" tone="muted">
            Couldn’t load this spot’s photos — tap to try again.
          </Text>
        </Row>
      )}
      <Button
        title={
          uploading
            ? 'Uploading…'
            : listState === 'ok'
              ? `Add a photo (${photos.length} of ${MAX_PHOTOS_PER_SPOT})`
              : 'Add a photo'
        }
        accessibilityLabel="Add a photo"
        variant="secondary"
        block
        icon={<Symbol name="photoBadgePlus" size="md" />}
        // Dimmed when it is genuinely inert. At the cap it stays lit, because
        // pressing it still does something useful: it explains the cap.
        disabled={uploading}
        onPress={add}
      />
      {/* FR-036 / Hard rule E, stated where it cannot be missed. The claim is
          verbatim: it is a promise about what the server does before anything
          is shown, and it must not be softened or shortened. */}
      <View style={styles.messageRow}>
        <Symbol name="checkmarkShield" size="sm" tone="muted" />
        <Text variant="footnote" tone="muted" style={styles.flex}>
          Photos are re-encoded on the server and location metadata is removed before anything is
          shown.
        </Text>
      </View>

      {/* The deliberate second step. The id is captured with the actions, so
          the press deletes what was asked about, not what the state says a
          frame later. */}
      <ConfirmDialog
        isPresented={asking !== null}
        onIsPresentedChange={(presented) => {
          if (!presented) setConfirmId(null);
        }}
        title="Delete this photo?"
        actions={[
          {
            title: 'Delete',
            role: 'destructive',
            accessibilityLabel: 'Confirm delete photo',
            onPress: () => {
              if (asking !== null) removeOne(asking);
            },
          },
          { title: 'Cancel', role: 'cancel', onPress: () => undefined },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  grid: { gap: GAP },
  gridRow: { gap: GAP },
  cell: { position: 'relative' },
  thumb: { width: '100%', height: '100%', borderRadius: radius.md, ...squircle },
  outline: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: radius.md,
    borderWidth: 1,
    ...squircle,
  },
  badge: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    width: BADGE,
    height: BADGE,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  flex: { flex: 1 },
});
