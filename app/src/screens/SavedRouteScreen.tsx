/**
 * A saved drive, reopened (M8-T04/T08; FR-074 — the SAME RouteDetail component
 * renders Result, saved routes and shared-link routes; §16 cohesion rule 1).
 *
 * Owner controls live here rather than in the list: visibility (T08) and
 * delete. Fetch is by id through RLS — a row that isn't yours (or was deleted)
 * comes back null and gets an honest state, never a crash or a blank screen.
 */

import type { Route } from '@shared/types';
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import HandoffSection from '../components/HandoffSection';
import RouteDetail from '../components/RouteDetail';
import SafetyNote from '../components/SafetyNote';
import { DataError } from '../lib/data';
import { fetchRouteById, updateVisibility } from '../lib/library';
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
  };
  route: { params?: SavedRouteScreenParams };
  cfg?: { url: string; anonKey: string };
  fetchRouteFn?: typeof fetchRouteById;
  setVisibilityFn?: typeof updateVisibility;
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
  const { freshAccessToken } = useAuth();
  const params = props.route.params;
  const cfg = props.cfg ?? getSupabaseConfig();
  const load = props.fetchRouteFn ?? fetchRouteById;
  const setVis = props.setVisibilityFn ?? updateVisibility;

  const [route, setRoute] = useState<Route | null>(null);
  const [visibility, setVisState] = useState<Vis>((params?.visibility as Vis) ?? 'private');
  const [state, setState] = useState<'loading' | 'ready' | 'gone' | 'error'>('loading');
  const [problem, setProblem] = useState<string | null>(null);

  const refresh = useCallback((): void => {
    if (!params?.id) return;
    void (async () => {
      try {
        const token = await freshAccessToken();
        const r = await load(cfg, params.id, token);
        if (r === null) {
          setState('gone');
          return;
        }
        setRoute(r);
        if (r.visibility) setVisState(r.visibility as Vis);
        setState('ready');
      } catch {
        setState('error');
      }
    })();
  }, [params?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(refresh, [refresh]);

  const choose = (next: Vis): void => {
    const previous = visibility;
    setVisState(next); // optimistic; reverted below if the server disagrees
    setProblem(null);
    void (async () => {
      try {
        const token = await freshAccessToken();
        if (!token || !params?.id) throw new DataError('Sign in again to change this.', null);
        await setVis(cfg, token, params.id, next);
      } catch (err) {
        setVisState(previous);
        setProblem(err instanceof DataError ? err.message : 'Could not change visibility.');
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
      </View>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content}>
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
                    {v}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={[styles.body, { color: colors.textMuted }]}>
            {visibilityBlurb(visibility)}
          </Text>
          {problem !== null && (
            <Text style={[styles.body, { color: colors.danger }]}>{problem}</Text>
          )}
        </View>
        <HandoffSection route={route} />
        <SafetyNote context="route" />
      </RouteDetail>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
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
  row: { flexDirection: 'row', gap: spacing.sm },
  chip: {
    minHeight: HIT_TARGET,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: { ...font.body },
});
