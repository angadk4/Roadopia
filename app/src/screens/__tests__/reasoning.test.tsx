/**
 * ReasoningView smoke (M7-T06; Hard rule I / RG-5) — collapsed by default,
 * expands to pipeline steps + tool grounding ONLY; renders nothing beyond the
 * schema-validated timeline (the backend asserts no reasoning-like keys exist
 * in any frame — plan-sse.test.ts).
 */
import { act } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';

import ReasoningView from '../../components/ReasoningView';
import type { TimelineEntry } from '../../lib/plan_run';

const TIMELINE: TimelineEntry[] = [
  { kind: 'step', step: 'parse', status: 'completed', detail: 'parser=llm' },
  { kind: 'tool', tool: 'find_curvy_roads', ok: true, count: 212 },
  { kind: 'step', step: 'validate_route', status: 'completed', detail: '3 feasible' },
  { kind: 'step', step: 'explain', status: 'completed', detail: 'source=llm' },
];

function textOf(tree: ReactTestRenderer): string {
  return JSON.stringify(tree.toJSON());
}

describe('ReasoningView', () => {
  it('is collapsed by default and expands on press to steps + tool grounding', () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<ReasoningView timeline={TIMELINE} />);
    });
    let text = textOf(tree);
    expect(text).toContain('How this route was built');
    expect(text).not.toContain('Understanding your brief'); // collapsed

    const header = tree.root.findAll(
      (n) =>
        n.props['accessibilityLabel'] === 'How this route was built' &&
        typeof n.props['onPress'] === 'function',
    )[0]!;
    act(() => {
      (header.props['onPress'] as () => void)();
    });
    text = textOf(tree);
    expect(text).toContain('Understanding your brief');
    expect(text).toContain('parser=llm'); // validated-output note
    expect(text).toContain('Curvy roads');
    expect(text).toContain('212 results'); // grounded result
    expect(text).toContain('source=llm');
    expect(text).toContain('nothing is invented after the fact');
  });

  it('renders nothing at all without a timeline', () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<ReasoningView timeline={[]} />);
    });
    expect(tree.toJSON()).toBeNull();
  });
});
