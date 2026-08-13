/**
 * Photo strip + upload for OWN spots (M10-T05; FR-035/036). Every rendered
 * image is a signed URL to the PROCESSED artifact — the UI has no concept of
 * the raw original (spec §56: nothing unprocessed is ever retrievable). The
 * picker asks for photo-library access only when tapped (§18) and transcodes
 * HEIC to JPEG on pick, matching the pipeline's accepted formats.
 */

import { useEffect, useState, type ReactElement } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ApiError } from '../lib/api';
import { deletePhoto, listSpotPhotos, uploadSpotPhoto, type PhotoRef } from '../lib/photos';
import { getApiBaseUrl } from '../lib/runtime';
import { useAuth } from '../lib/use_auth';
import { font, HIT_TARGET, radius, spacing, useTheme } from '../theme';

export interface PhotoUploadProps {
  spotId: string;
  /** Injectable for tests. */
  pickFn?: () => Promise<string | null>;
  uploadFn?: typeof uploadSpotPhoto;
  listFn?: typeof listSpotPhotos;
  deleteFn?: typeof deletePhoto;
  baseUrl?: string;
}

/** Default picker — imported lazily so node tests never load the native module. */
async function pickImage(): Promise<string | null> {
  const ImagePicker = await import('expo-image-picker');
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: 'images',
    quality: 0.85, // re-encodes on pick (HEIC → JPEG)
    allowsMultipleSelection: false,
  });
  if (result.canceled || result.assets.length === 0) return null;
  return result.assets[0]!.uri;
}

type Phase = { kind: 'idle' } | { kind: 'uploading' } | { kind: 'problem'; message: string };

export default function PhotoUpload(props: PhotoUploadProps): ReactElement {
  const { colors } = useTheme();
  const { freshAccessToken } = useAuth();
  const baseUrl = props.baseUrl ?? getApiBaseUrl();
  const pick = props.pickFn ?? pickImage;
  const upload = props.uploadFn ?? uploadSpotPhoto;
  const list = props.listFn ?? listSpotPhotos;
  const remove = props.deleteFn ?? deletePhoto;

  const [photos, setPhotos] = useState<PhotoRef[]>([]);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  useEffect(() => {
    void (async () => {
      try {
        const token = await freshAccessToken();
        if (!token) return;
        setPhotos(await list({ baseUrl, accessToken: token }, props.spotId));
      } catch {
        // photo list failing is enrichment loss, not a broken screen (§18)
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.spotId]);

  const add = (): void => {
    void (async () => {
      try {
        const uri = await pick();
        if (uri === null) return; // permission refused or cancelled — no error
        setPhase({ kind: 'uploading' });
        const token = await freshAccessToken();
        if (!token)
          throw new ApiError({
            status: 401,
            code: 'auth',
            message: 'Sign in again to add photos.',
          });
        const ref = await upload({ baseUrl, accessToken: token }, props.spotId, uri);
        setPhotos((p) => [...p, ref]);
        setPhase({ kind: 'idle' });
      } catch (err) {
        setPhase({
          kind: 'problem',
          message: err instanceof ApiError ? err.message : 'Could not upload the photo.',
        });
      }
    })();
  };

  const removeOne = (id: string): void => {
    void (async () => {
      try {
        const token = await freshAccessToken();
        if (!token)
          throw new ApiError({ status: 401, code: 'auth', message: 'Sign in again first.' });
        await remove({ baseUrl, accessToken: token }, id);
        setPhotos((p) => p.filter((x) => x.id !== id));
      } catch (err) {
        setPhase({
          kind: 'problem',
          message: err instanceof ApiError ? err.message : 'Could not delete the photo.',
        });
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
          {photos.map((p) => (
            <View key={p.id} style={styles.cell}>
              <Image
                source={{ uri: p.thumb_url }}
                style={[styles.thumb, { backgroundColor: colors.surface }]}
                accessibilityLabel="Spot photo"
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Delete photo"
                onPress={() => removeOne(p.id)}
                style={[
                  styles.deleteBadge,
                  { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
                ]}
              >
                <Text style={[styles.deleteMark, { color: colors.danger }]}>✕</Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}
      {phase.kind === 'problem' && (
        <Text style={[styles.problem, { color: colors.danger }]}>{phase.message}</Text>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add a photo"
        disabled={phase.kind === 'uploading'}
        onPress={add}
        style={[styles.addBtn, { borderColor: colors.border }]}
      >
        <Text style={[styles.addLabel, { color: colors.text }]}>
          {phase.kind === 'uploading' ? 'Processing…' : 'Add a photo'}
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
    top: 4,
    right: 4,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteMark: { fontSize: 13, fontWeight: '700' },
  problem: { ...font.caption },
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
