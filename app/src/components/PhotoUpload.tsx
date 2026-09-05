/**
 * Photo strip + upload for OWN spots (M10-T05; FR-035/036). Every rendered
 * image is a signed URL to the PROCESSED artifact — the UI has no concept of
 * the raw original (spec §56: nothing unprocessed is ever retrievable). The
 * picker asks for photo-library access only when tapped (§18) and transcodes
 * HEIC to JPEG on pick, matching the pipeline's accepted formats.
 *
 * Device pass (2026-09-04): delete needs a second tap on a 44 pt target; the
 * button says "Uploading…" (we cannot see the server's processing step, so
 * we do not claim it); the count against the per-spot cap is shown; and a
 * photo over the server's size cap is refused before a long upload, not
 * after it.
 */

import { useEffect, useState, type ReactElement } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ApiError, NetworkError } from '../lib/api';
import { deletePhoto, listSpotPhotos, uploadSpotPhoto, type PhotoRef } from '../lib/photos';
import { getApiBaseUrl } from '../lib/runtime';
import { useAuth } from '../lib/use_auth';
import { font, HIT_TARGET, radius, spacing, useTheme } from '../theme';

/** Client mirror of backend/src/routes/photos.ts MAX_PHOTOS_PER_SPOT. The
 *  server enforces it inside the insert; this only lets the UI say so first. */
export const MAX_PHOTOS_PER_SPOT = 6;
/** Client mirror of backend/src/images/process.ts MAX_IMAGE_BYTES (10 MB). */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** What the picker hands back: the local uri, and its size when the OS says. */
export interface PickedImage {
  uri: string;
  bytes?: number | null;
}

export interface PhotoUploadProps {
  spotId: string;
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

/** NetworkError is NOT an ApiError, so an `instanceof ApiError` check threw away
 *  exactly the messages that tell an offline user what to do. */
function problemText(err: unknown, fallback: string): string {
  if (err instanceof ApiError || err instanceof NetworkError) return err.message;
  return fallback;
}

export default function PhotoUpload(props: PhotoUploadProps): ReactElement {
  const { colors } = useTheme();
  const { freshAccessToken, status } = useAuth();
  const baseUrl = props.baseUrl ?? getApiBaseUrl();
  const pick = props.pickFn ?? pickImage;
  const upload = props.uploadFn ?? uploadSpotPhoto;
  const list = props.listFn ?? listSpotPhotos;
  const remove = props.deleteFn ?? deletePhoto;

  const [photos, setPhotos] = useState<PhotoRef[]>([]);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  /** The photo whose delete is armed (first tap); second tap deletes. */
  const [armedId, setArmedId] = useState<string | null>(null);
  /** Whether the strip is KNOWN: the count against the cap is only claimed
   *  once the list actually loaded (review finding: "0 of 6" after a failed
   *  load was a number the component never measured). */
  const [listState, setListState] = useState<'loading' | 'ok' | 'failed'>('loading');
  const [listAttempt, setListAttempt] = useState(0);

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
      } catch (err) {
        setPhase({ kind: 'problem', message: problemText(err, 'Could not upload the photo.') });
      }
    })();
  };

  const removeOne = (id: string): void => {
    if (armedId !== id) {
      setArmedId(id); // first tap arms; a stray tap must not delete a photo
      return;
    }
    setArmedId(null);
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

  return (
    <View style={styles.wrap}>
      {photos.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.strip}
        >
          {photos.map((p) => {
            const armed = armedId === p.id;
            return (
              <View key={p.id} style={styles.cell}>
                <Image
                  source={{ uri: p.thumb_url }}
                  style={[styles.thumb, { backgroundColor: colors.surface }]}
                  accessibilityLabel="Spot photo"
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={armed ? 'Confirm delete photo' : 'Delete photo'}
                  onPress={() => removeOne(p.id)}
                  style={[
                    styles.deleteBadge,
                    armed && styles.deleteBadgeArmed,
                    {
                      backgroundColor: armed ? colors.danger : colors.surfaceRaised,
                      borderColor: armed ? colors.danger : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[styles.deleteMark, { color: armed ? colors.onAccent : colors.danger }]}
                  >
                    {armed ? 'Delete?' : '✕'}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </ScrollView>
      )}
      {phase.kind === 'problem' && (
        <Text style={[styles.problem, { color: colors.danger }]}>{phase.message}</Text>
      )}
      {listState === 'failed' && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry loading photos"
          onPress={() => {
            setListState('loading');
            setListAttempt((a) => a + 1);
          }}
          style={styles.retry}
        >
          <Text style={[styles.problem, { color: colors.textMuted }]}>
            Couldn’t load this spot’s photos — tap to try again.
          </Text>
        </Pressable>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add a photo"
        disabled={phase.kind === 'uploading'}
        onPress={add}
        style={[styles.addBtn, { borderColor: colors.border, opacity: full ? 0.6 : 1 }]}
      >
        <Text style={[styles.addLabel, { color: colors.text }]}>
          {phase.kind === 'uploading'
            ? 'Uploading…'
            : listState === 'ok'
              ? `Add a photo (${photos.length} of ${MAX_PHOTOS_PER_SPOT})`
              : 'Add a photo'}
        </Text>
      </Pressable>
      <Text style={[styles.note, { color: colors.textMuted }]}>
        Photos are re-encoded on the server and location metadata is removed before anything is
        shown.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  strip: { gap: spacing.sm },
  cell: { position: 'relative' },
  thumb: { width: 96, height: 96, borderRadius: radius.md },
  deleteBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: HIT_TARGET,
    minHeight: HIT_TARGET,
    borderBottomLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  deleteBadgeArmed: { left: 0, borderRadius: radius.md },
  deleteMark: { ...font.caption, fontWeight: '700' },
  problem: { ...font.caption },
  retry: { minHeight: HIT_TARGET, justifyContent: 'center' },
  addBtn: {
    minHeight: HIT_TARGET,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addLabel: { ...font.body },
  note: { ...font.caption, lineHeight: 16 },
});
