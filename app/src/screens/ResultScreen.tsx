/**
 * Route result (M7-T05; FR-042 — "= route detail with constraints panel +
 * explanation", §15). Hosts the SHARED RouteDetail component; the reasoning
 * view (M7-T06) and inline refinement (M7-T07) mount as conditional sections
 * inside it (§16 cohesion rules 2–3). Save/share/navigate arrive at M8/M9.
 */

import type { ParsedConstraints, Route } from '@shared/types';
import type { ReactElement } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import ReasoningView from '../components/ReasoningView';
import RefinePanel from '../components/RefinePanel';
import RouteCompare from '../components/RouteCompare';
import RouteDetail from '../components/RouteDetail';
import type { Explanation, TimelineEntry } from '../lib/plan_run';
import type { DoneStatus } from '../lib/plan_stream';
import { buildRefineRequest, summarizeRoute, type RouteSummary } from '../lib/refine';
import { font, HIT_TARGET, radius, spacing, useTheme } from '../theme';

export interface ResultScreenParams {
  route?: Route;
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
  const r = params.route;

  if (!r) {
    // Defensive only — Progress never navigates here without a route.
    return (
      <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content}>
        <Text style={[font.body, { color: colors.textMuted }]}>
          No route arrived — go back and plan again.
        </Text>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {params.previous && <RouteCompare previous={params.previous} next={summarizeRoute(r)} />}
      <RouteDetail route={r} explanation={params.explanation ?? null} done={params.done ?? null}>
        <ReasoningView timeline={params.timeline ?? []} />
        {params.constraints && (
          <RefinePanel
            onSend={(followUp) =>
              props.navigation.navigate('Progress', {
                request: buildRefineRequest(params.constraints!, followUp),
                previous: summarizeRoute(r),
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
  again: {
    minHeight: HIT_TARGET,
    borderWidth: 1.5,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  againLabel: { ...font.button },
});
