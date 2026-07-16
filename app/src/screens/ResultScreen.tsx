/**
 * Route result (M7-T05; FR-042 — "= route detail with constraints panel +
 * explanation", §15). Hosts the SHARED RouteDetail component; the reasoning
 * view (M7-T06) and inline refinement (M7-T07) mount as conditional sections
 * inside it (§16 cohesion rules 2–3). FB-4: the planner's feasible runner-up
 * options are switchable — the deterministic answer to "same prompt, same
 * route". Save/share/navigate arrive at M8/M9.
 */

import type { ParsedConstraints, Route } from '@shared/types';
import { useState, type ReactElement } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import ReasoningView from '../components/ReasoningView';
import RefinePanel from '../components/RefinePanel';
import RouteCompare from '../components/RouteCompare';
import RouteDetail from '../components/RouteDetail';
import type { Explanation, TimelineEntry } from '../lib/plan_run';
import type { DoneStatus } from '../lib/plan_stream';
import {
  buildRefineRequest,
  refineUnchanged,
  summarizeRoute,
  type RouteSummary,
} from '../lib/refine';
import { font, HIT_TARGET, radius, spacing, useTheme } from '../theme';

export interface ResultScreenParams {
  route?: Route;
  /** Feasible runner-up options (FB-4) — no elevation/LLM enrich (best-only). */
  alternates?: Route[];
  explanation?: Explanation | null;
  done?: DoneStatus | null;
  timeline?: TimelineEntry[];
  /** The running `c` from this generation — enables inline refinement (§34). */
  constraints?: ParsedConstraints | null;
  /** Present when this result came from a refinement — drives the comparison. */
  previous?: RouteSummary | null;
}

export interface ResultScreenProps {
  navigation: {
    goBack: () => void;
    navigate: (screen: string, params?: Record<string, unknown>) => void;
  };
  route: { params?: ResultScreenParams };
}

export default function ResultScreen(props: ResultScreenProps): ReactElement {
  const { colors } = useTheme();
  const params = props.route.params ?? {};
  const best = params.route;
  const alternates = params.alternates ?? [];
  // 0 = the recommended route; 1.. = runner-up options
  const [selected, setSelected] = useState(0);

  if (!best) {
    // Defensive only — Progress never navigates here without a route.
    return (
      <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content}>
        <Text style={[font.body, { color: colors.textMuted }]}>
          No route arrived — go back and plan again.
        </Text>
      </ScrollView>
    );
  }

  const options = [best, ...alternates];
  const shown = options[Math.min(selected, options.length - 1)]!;
  const viewingBest = selected === 0;

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {/* option switcher — deterministic variety (FB-4) */}
      {alternates.length > 0 && (
        <View style={styles.optionRow}>
          {options.map((_, i) => {
            const active = i === Math.min(selected, options.length - 1);
            return (
              <Pressable
                key={i}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => setSelected(i)}
                style={({ pressed }) => [
                  styles.optionChip,
                  {
                    backgroundColor: active ? colors.accent : colors.surface,
                    borderColor: active ? colors.accent : colors.border,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <Text
                  style={[styles.optionLabel, { color: active ? colors.onAccent : colors.text }]}
                >
                  {i === 0 ? 'Recommended' : `Option ${i + 1}`}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {viewingBest && params.previous && refineUnchanged(params.previous, summarizeRoute(best)) && (
        <View
          style={[styles.honest, { backgroundColor: colors.surface, borderColor: colors.warn }]}
        >
          <Text style={[styles.honestText, { color: colors.warn }]}>
            That tweak couldn't improve on the previous drive from this start — the planner keeps
            quality first (no forced u-turns or messy detours just to hit a number). This is still
            its best answer.
          </Text>
        </View>
      )}
      {viewingBest && params.previous && (
        <RouteCompare previous={params.previous} next={summarizeRoute(best)} />
      )}

      <RouteDetail
        route={shown}
        explanation={viewingBest ? (params.explanation ?? null) : null}
        done={viewingBest ? (params.done ?? null) : null}
      >
        {!viewingBest && (
          <Text style={[styles.altNote, { color: colors.textMuted }]}>
            A feasible runner-up from the same generation. The detailed explanation and elevation
            belong to the recommended option.
          </Text>
        )}
        {viewingBest && <ReasoningView timeline={params.timeline ?? []} />}
        {params.constraints && (
          <RefinePanel
            onSend={(followUp) =>
              props.navigation.navigate('Progress', {
                request: buildRefineRequest(params.constraints!, followUp),
                previous: summarizeRoute(shown),
              })
            }
          />
        )}
      </RouteDetail>

      <Pressable
        accessibilityRole="button"
        onPress={props.navigation.goBack}
        style={({ pressed }) => [
          styles.again,
          { borderColor: colors.accent, opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <Text style={[styles.againLabel, { color: colors.accent }]}>Plan another drive</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  optionChip: {
    minHeight: HIT_TARGET,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionLabel: { ...font.button, fontSize: 15 },
  honest: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  honestText: { ...font.body, lineHeight: 20 },
  altNote: { ...font.caption, lineHeight: 16 },
  again: {
    minHeight: HIT_TARGET,
    borderWidth: 1.5,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  againLabel: { ...font.button },
});
