/**
 * Spot detail (M10-T02/T04; FR-030/032/034; spec §15). Fetch is by id through
 * RLS — OSM seeds are visible to everyone and NOT editable (FR-032: the
 * server refuses even if this UI lied); a user spot is visible/editable only
 * to its owner in MVP. Any spot is reportable, signed in or not (T06).
 * Photos join at T05.
 */

import { useEffect, useState, type ReactElement } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import PhotoUpload from '../components/PhotoUpload';
import ReportButton from '../components/ReportButton';
import { DataError } from '../lib/data';
import { getApiBaseUrl, getSupabaseConfig } from '../lib/runtime';
import {
  deleteSpot,
  fetchSpotById,
  parseTags,
  SPOT_DESC_MAX,
  SPOT_NAME_MAX,
  updateSpot,
  type SpotDetail,
} from '../lib/spots';
import { useAuth } from '../lib/use_auth';
import { font, HIT_TARGET, radius, spacing, useTheme } from '../theme';

export interface SpotDetailScreenParams {
  id: string;
  /** Shown while the row loads so the screen is never blank. */
  name?: string;
}

export interface SpotDetailScreenProps {
  navigation: { goBack: () => void };
  route: { params?: SpotDetailScreenParams };
  /** Injectable for tests. */
  cfg?: { url: string; anonKey: string };
  fetchFn?: typeof fetchSpotById;
  updateFn?: typeof updateSpot;
  deleteFn?: typeof deleteSpot;
}

type Phase = 'loading' | 'ready' | 'gone' | 'error';

export default function SpotDetailScreen(props: SpotDetailScreenProps): ReactElement {
  const { colors } = useTheme();
  const { freshAccessToken, user } = useAuth();
  const cfg = props.cfg ?? getSupabaseConfig();
  const load = props.fetchFn ?? fetchSpotById;
  const update = props.updateFn ?? updateSpot;
  const remove = props.deleteFn ?? deleteSpot;
  const params = props.route.params;

  const [spot, setSpot] = useState<SpotDetail | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [busy, setBusy] = useState(false);
  /** Deleting a spot takes its photos with it — one stray tap shouldn't. */
  const [armed, setArmed] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!params?.id) {
      setPhase('gone');
      return;
    }
    void (async () => {
      try {
        const token = await freshAccessToken();
        const s = await load(cfg, params.id, token);
        if (s === null) {
          setPhase('gone');
          return;
        }
        setSpot(s);
        setName(s.name);
        setDescription(s.description);
        setTagsText(s.tags.join(', '));
        setPhase('ready');
      } catch {
        setPhase('error');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params?.id]);

  if (phase === 'loading') {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (phase !== 'ready' || spot === null) {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <Text style={[styles.body, { color: colors.textMuted }]}>
          {phase === 'gone'
            ? 'That spot isn’t available — it may have been removed.'
            : 'Could not load that spot right now.'}
        </Text>
      </View>
    );
  }

  const mine = spot.owner_id !== null && spot.owner_id === user?.id;
  const editable = mine && spot.source === 'user'; // FR-032/034

  const saveEdits = (): void => {
    setBusy(true);
    setProblem(null);
    void (async () => {
      try {
        const token = await freshAccessToken();
        if (!token) throw new DataError('Sign in again to edit this.', null);
        const changed = await update(cfg, token, spot.id, {
          name,
          description,
          tags: parseTags(tagsText),
        });
        if (!changed) throw new DataError('That spot isn’t yours to edit.', null);
        setSpot({ ...spot, name: name.trim(), description, tags: parseTags(tagsText) });
        setEditing(false);
      } catch (err) {
        setProblem(err instanceof DataError ? err.message : 'Could not save the changes.');
      } finally {
        setBusy(false);
      }
    })();
  };

  const doDelete = (): void => {
    setBusy(true);
    setProblem(null);
    void (async () => {
      try {
        const token = await freshAccessToken();
        if (!token) throw new DataError('Sign in again to delete this.', null);
        await remove(getApiBaseUrl(), token, spot.id);
        props.navigation.goBack();
      } catch (err) {
        setProblem(err instanceof DataError ? err.message : 'Could not delete the spot.');
        setBusy(false);
        setArmed(false);
      }
    })();
  };

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content}>
      <Text style={[styles.kicker, { color: colors.textMuted }]}>
        {spot.type.replace('_', ' ')}
        {spot.source === 'osm' ? ' · from OpenStreetMap' : ''}
      </Text>

      {editing ? (
        <>
          <TextInput
            accessibilityLabel="Spot name"
            value={name}
            onChangeText={(t) => setName(t.slice(0, SPOT_NAME_MAX))}
            style={[
              styles.input,
              { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface },
            ]}
          />
          <TextInput
            accessibilityLabel="Spot description"
            value={description}
            onChangeText={(t) => setDescription(t.slice(0, SPOT_DESC_MAX))}
            maxLength={SPOT_DESC_MAX}
            multiline
            placeholder="What makes it worth stopping?"
            placeholderTextColor={colors.textMuted}
            style={[
              styles.input,
              styles.multiline,
              { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface },
            ]}
          />
          <TextInput
            accessibilityLabel="Spot tags"
            value={tagsText}
            onChangeText={setTagsText}
            autoCapitalize="none"
            placeholder="Tags, comma-separated"
            placeholderTextColor={colors.textMuted}
            style={[
              styles.input,
              { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface },
            ]}
          />
          <View style={styles.row}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save changes"
              disabled={busy}
              onPress={saveEdits}
              style={({ pressed }) => [
                styles.primaryBtn,
                { backgroundColor: colors.accent, opacity: pressed || busy ? 0.85 : 1 },
              ]}
            >
              <Text style={[styles.primaryLabel, { color: colors.onAccent }]}>
                {busy ? 'Saving…' : 'Save changes'}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel editing"
              onPress={() => {
                // reseed from the saved row — leaving the drafts in place made
                // "Cancel" a lie: the next Edit → Save wrote the abandoned text
                setName(spot.name);
                setDescription(spot.description);
                setTagsText(spot.tags.join(', '));
                setProblem(null);
                setEditing(false);
              }}
              style={[styles.secondaryBtn, { borderColor: colors.border }]}
            >
              <Text style={[styles.secondaryLabel, { color: colors.text }]}>Cancel</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <>
          <Text style={[styles.title, { color: colors.text }]}>{spot.name || 'Unnamed spot'}</Text>
          {spot.description.length > 0 && (
            <Text style={[styles.body, { color: colors.text }]}>{spot.description}</Text>
          )}
          {spot.tags.length > 0 && (
            <View style={styles.tagRow}>
              {spot.tags.map((t) => (
                <View key={t} style={[styles.tag, { borderColor: colors.border }]}>
                  <Text style={[styles.tagText, { color: colors.textMuted }]}>{t}</Text>
                </View>
              ))}
            </View>
          )}
          {editable && (
            <View style={styles.row}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit spot"
                onPress={() => setEditing(true)}
                style={[styles.secondaryBtn, { borderColor: colors.border }]}
              >
                <Text style={[styles.secondaryLabel, { color: colors.text }]}>Edit</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={armed ? 'Confirm delete spot' : 'Delete spot'}
                disabled={busy}
                onPress={() => (armed ? doDelete() : setArmed(true))}
                style={[styles.secondaryBtn, { borderColor: colors.danger }]}
              >
                <Text style={[styles.secondaryLabel, { color: colors.danger }]}>
                  {busy ? 'Deleting…' : armed ? 'Tap again to delete' : 'Delete'}
                </Text>
              </Pressable>
            </View>
          )}
        </>
      )}

      {problem !== null && (
        <Text style={[styles.problem, { color: colors.danger }]}>{problem}</Text>
      )}

      {/* M10-T05: photos on OWN spots — processed server-side before display */}
      {editable && <PhotoUpload spotId={spot.id} />}

      <ReportButton targetType="spot" targetId={spot.id} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  content: { padding: spacing.lg, gap: spacing.md },
  kicker: { ...font.caption, textTransform: 'capitalize' },
  title: { ...font.title },
  body: { ...font.body, lineHeight: 21 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tag: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  tagText: { ...font.caption },
  row: { flexDirection: 'row', gap: spacing.sm },
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: HIT_TARGET,
    ...font.body,
  },
  multiline: { minHeight: HIT_TARGET * 1.6, textAlignVertical: 'top' },
  primaryBtn: {
    minHeight: HIT_TARGET,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryLabel: { ...font.button },
  secondaryBtn: {
    minHeight: HIT_TARGET,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryLabel: { ...font.body },
  problem: { ...font.caption },
});
