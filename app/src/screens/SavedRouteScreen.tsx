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
 */

import type { Route } from '@shared/types';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import HandoffSection from '../components/HandoffSection';
import RouteDetail from '../components/RouteDetail';
import SafetyNote from '../components/SafetyNote';
import { DataError } from '../lib/data';
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

/** Plain words for each choice — no jargon, no false promises (§18). */
export function visibilityBlurb(v: Vis): string {
  if (v === 'private') return 'Only you can see this drive.';
  if (v === 'unlisted') return 'Anyone with the link can open it. It never shows up in browse.';
  return 'Anyone can find and open this drive.';
}

export default function SavedRouteScreen(props: SavedRouteScreenProps): ReactElement {
  const { colors } = useTheme();
  const { freshAccessToken, gate } = useAuth();
  const params = props.route.params;
  const cfg = props.cfg ?? getSupabaseConfig();
  const load = props.fetchRouteFn ?? fetchRouteById;
  const setVis = props.setVisibilityFn ?? updateVisibility;
  const rename = props.renameFn ?? renameRoute;
  const remove = props.deleteFn ?? deleteRoute;

  const [route, setRoute] = useState<Route | null>(null);
  const [visibility, setVisState] = useState<Vis>((params?.visibility as Vis) ?? 'private');
  const [state, setState] = useState<'loading' | 'ready' | 'gone' | 'error'>('loading');
  const [problem, setProblem] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [busy, setBusy] = useState(false);
  /** Deleting takes the drive with it — one stray tap shouldn't. */
  const [armed, setArmed] = useState(false);

  /** Generation of the latest load: mount + the first focus both fire one,
   *  and a rename/visibility change invalidates whatever is still loading —
   *  a late GET must never overwrite an edit the user just saw succeed. */
  const gen = useRef(0);

  const refresh = useCallback((): void => {
    if (!params?.id) return;
    const my = ++gen.current;
    void (async () => {
      try {
        const token = await freshAccessToken();
        const r = await load(cfg, params.id, token);
        if (my !== gen.current) return; // superseded
        if (r === null) {
          setState('gone');
          return;
        }
        setRoute(r);
        if (r.visibility) setVisState(r.visibility as Vis);
        if (r.name) props.navigation.setTitle?.(r.name);
        setState('ready');
      } catch {
        if (my === gen.current) setState('error');
      }
    })();
  }, [params?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
      const token = await freshAccessToken();
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
      const token = await freshAccessToken();
      if (!token || !params?.id) {
        setBusy(false);
        gate(submitRename, { onDismiss: notChanged });
        return;
      }
      try {
        const saved = await rename(cfg, token, params.id, clean);
        gen.current += 1; // a load still in flight predates this rename
        setRoute((r) => (r ? { ...r, name: saved } : r));
        props.navigation.setTitle?.(saved);
        setRenaming(false);
      } catch (err) {
        setProblem(err instanceof DataError ? err.message : 'Could not rename the drive.');
      } finally {
        setBusy(false);
      }
    })();
  };

  const doDelete = (): void => {
    if (!armed) {
      setArmed(true); // first tap arms; second tap deletes
      return;
    }
    setBusy(true);
    setProblem(null);
    void (async () => {
      const token = await freshAccessToken();
      if (!token || !params?.id) {
        setBusy(false);
        setArmed(false);
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
        setBusy(false);
        setArmed(false);
      }
    })();
  };

  if (state === 'loading') {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (state !== 'ready' || route === null) {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <Text style={[styles.body, { color: colors.textMuted }]}>
          {state === 'gone'
            ? 'That drive isn’t available any more — it may have been deleted.'
            : 'Could not load that drive right now.'}
        </Text>
        {state === 'error' && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry"
            onPress={refresh}
            style={[styles.secondaryBtn, { borderColor: colors.border }]}
          >
            <Text style={[styles.body, { color: colors.text }]}>Retry</Text>
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <RouteDetail route={route} explanation={null} done={null}>
        {/* M9-T06 (FR-112): saved drives are followable too */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Follow this drive"
          onPress={() => props.navigation.navigate('Follow', { route })}
          style={({ pressed }) => [
            styles.follow,
            { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={[styles.followLabel, { color: colors.onAccent }]}>Follow this drive</Text>
        </Pressable>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Name</Text>
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
                    borderColor: colors.border,
                    backgroundColor: colors.surface,
                  },
                ]}
              />
              <View style={styles.row}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Save name"
                  disabled={busy}
                  onPress={submitRename}
                  style={[
                    styles.primaryBtn,
                    { backgroundColor: colors.accent, opacity: busy ? 0.6 : 1 },
                  ]}
                >
                  <Text style={[styles.primaryLabel, { color: colors.onAccent }]}>
                    {busy ? 'Saving…' : 'Save name'}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cancel rename"
                  onPress={() => {
                    setRenaming(false);
                    setProblem(null);
                  }}
                  style={[styles.secondaryBtn, { borderColor: colors.border }]}
                >
                  <Text style={[styles.body, { color: colors.text }]}>Cancel</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Rename drive"
              onPress={() => {
                setNameDraft(route.name ?? params?.name ?? '');
                setRenaming(true);
              }}
              style={[styles.secondaryBtn, { borderColor: colors.border }]}
            >
              <Text style={[styles.body, { color: colors.text }]}>Rename</Text>
            </Pressable>
          )}
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Who can see this</Text>
          <View style={styles.row}>
            {VISIBILITIES.map((v) => {
              const active = v === visibility;
              return (
                <Pressable
                  key={v}
                  onPress={() => choose(v)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Set visibility ${v}`}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: active ? colors.accent : colors.surface,
                      borderColor: active ? colors.accent : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[styles.chipText, { color: active ? colors.onAccent : colors.text }]}
                  >
                    {visibilityLabel(v)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={[styles.body, { color: colors.textMuted }]}>
            {visibilityBlurb(visibility)}
          </Text>
        </View>

        {problem !== null && <Text style={[styles.body, { color: colors.danger }]}>{problem}</Text>}

        <HandoffSection route={route} />
        <SafetyNote context="route" />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={armed ? 'Confirm delete drive' : 'Delete drive'}
          disabled={busy}
          onPress={doDelete}
          style={[styles.secondaryBtn, styles.deleteBtn, { borderColor: colors.danger }]}
        >
          <Text style={[styles.body, { color: colors.danger }]}>
            {busy && armed
              ? 'Deleting…'
              : armed
                ? 'Tap again to delete this drive'
                : 'Delete drive'}
          </Text>
        </Pressable>
      </RouteDetail>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  content: { padding: spacing.lg, gap: spacing.md },
  body: { ...font.body, lineHeight: 21 },
  section: { gap: spacing.sm, marginTop: spacing.md },
  sectionTitle: { ...font.heading },
  follow: {
    minHeight: HIT_TARGET + 8,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  followLabel: { ...font.button },
  row: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  chip: {
    minHeight: HIT_TARGET,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: { ...font.body },
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: HIT_TARGET,
    ...font.body,
  },
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
    alignSelf: 'flex-start',
  },
  deleteBtn: { alignSelf: 'stretch', marginTop: spacing.lg },
});
