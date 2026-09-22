/**
 * The react-native-gesture-handler stub (BD-204 redesign).
 *
 * The library is imported by PACKAGE NAME, which is what proves the alias in
 * app/vitest.config.ts resolves (the real module throws at import in node).
 * It also means this file type-checks against the REAL types — tsc resolves
 * the real package, only vitest sees the stub — so a builder here is typed as
 * the real `PanGesture` and the stub-only inspection fields are reached
 * through `__stubGesture`, exactly as a screen test will. The `__` hooks come
 * from the stub's own path (the real types do not declare them) and act on
 * the same module instance the alias resolves to.
 *
 * Two promises are pinned, because the whole suite rests on them: a tree with
 * a `GestureDetector` in it survives `JSON.stringify(tree.toJSON())` — the
 * builder never reaches a host element — and a test can DRIVE the handlers a
 * screen registered, from outside (`__fireGesture` on a builder it holds) and
 * from inside (`__mountedGesture` on one the screen built for itself).
 */

import { act, createRef, useMemo, type ReactElement } from 'react';
import { Text, View } from 'react-native';
import {
  Directions,
  FlatList,
  Gesture,
  GestureDetector,
  gestureHandlerRootHOC,
  GestureHandlerRootView,
  PanGestureHandler,
  RectButton,
  State,
  type GestureType,
  type PanGestureHandlerProps,
} from 'react-native-gesture-handler';
import { create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';

import {
  __clearMountedGestures,
  __fireGesture,
  __mountedGesture,
  __mountedGestures,
  __stubGesture,
} from '../gesture-handler-stub';

function render(node: ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(node);
  });
  return tree;
}

const textOf = (tree: ReactTestRenderer): string => JSON.stringify(tree.toJSON());

/** The one host element of a stub's tag. A predicate rather than
 *  `findByType`, whose parameter is React's `ElementType` — DOM tag names
 *  only under strict TS, so a stub's own tag would not type-check. */
const host = (tree: ReactTestRenderer, tag: string): ReactTestInstance =>
  tree.root.find((n) => n.type === tag);

/** Every host element of a tag (same widened-`string` reason as `host`). */
const hosts = (tree: ReactTestRenderer, tag: string): ReactTestInstance[] =>
  tree.root.findAll((n) => n.type === tag);

/** A class instance whose graph loops back on itself — what a ref's `current`
 *  or an Animated.event object looks like to JSON.stringify. */
class Cyclic {
  self: Cyclic;
  constructor() {
    this.self = this;
  }
}

/** A screen that builds its own gesture — the shape every real sheet has. */
function Sheet(props: { onDismiss: () => void }): ReactElement {
  const { onDismiss } = props;
  const drag = useMemo(
    () =>
      Gesture.Pan()
        .withTestId('sheet-drag')
        .activeOffsetY(12)
        .onEnd((e) => {
          if (e.translationY > 80) onDismiss();
        }),
    [onDismiss],
  );
  return (
    <GestureDetector gesture={drag}>
      <View>
        <Text>Sheet</Text>
      </View>
    </GestureDetector>
  );
}

describe('GestureDetector + Gesture builders', () => {
  afterEach(() => {
    __clearMountedGestures();
  });

  it('renders a serialisable tree and lets a test drive the pan it wraps', () => {
    const updates: number[] = [];
    const ends: Array<{ velocityY: number; state: number; oldState: number; ok: boolean }> = [];
    const pan = Gesture.Pan()
      .activeOffsetY([-12, 12])
      .onUpdate((e) => {
        updates.push(e.translationY);
      })
      .onEnd((e, ok) => {
        ends.push({ velocityY: e.velocityY, state: e.state, oldState: e.oldState, ok });
      });

    const tree = render(
      <GestureHandlerRootView>
        <GestureDetector gesture={pan}>
          <View testID="sheet">
            <Text>Drag to dismiss</Text>
          </View>
        </GestureDetector>
      </GestureHandlerRootView>,
    );

    expect(() => textOf(tree)).not.toThrow();
    const text = textOf(tree);
    expect(text).toContain('Drag to dismiss');
    expect(text).not.toContain('gesture'); // the builder is not in the tree
    expect(text).not.toContain('__handlers');

    expect(__fireGesture(pan, 'update', { translationY: 48 })).toBe(true);
    expect(__fireGesture(pan, 'update', { translationY: 96 })).toBe(true);
    expect(updates).toEqual([48, 96]);

    expect(__fireGesture(pan, 'end', { velocityY: 900 })).toBe(true);
    expect(ends).toEqual([{ velocityY: 900, state: State.END, oldState: State.ACTIVE, ok: true }]);
    expect(__fireGesture(pan, 'end', {}, false)).toBe(true);
    expect(ends[1]?.ok).toBe(false);

    // A phase nobody registered says so, instead of pretending it ran.
    expect(__fireGesture(pan, 'begin')).toBe(false);
  });

  it('every configuration call returns the same builder and records what it was told', () => {
    const pan = Gesture.Pan();
    const scroll = Gesture.Native();
    const press = Gesture.LongPress();
    const scrollRef = { current: scroll };
    const chained = pan
      .enabled(true)
      .minDistance(8)
      .activeOffsetX([-10, 10])
      .failOffsetY(20)
      .runOnJS(true)
      .withTestId('sheet-drag')
      .shouldCancelWhenOutside(false)
      .hitSlop({ top: 8 })
      .simultaneousWithExternalGesture(scrollRef)
      .requireExternalGestureToFail(press)
      .blocksExternalGesture(scroll, { current: undefined });
    expect(chained).toBe(pan);
    expect(__stubGesture(pan).__config).toEqual({
      enabled: true,
      minDistance: 8,
      activeOffsetX: [-10, 10],
      failOffsetY: 20,
      runOnJS: true,
      testId: 'sheet-drag',
      shouldCancelWhenOutside: false,
      hitSlop: { top: 8 },
      simultaneousWith: [scroll.handlerTag],
      requireToFail: [press.handlerTag],
      blocksHandlers: [scroll.handlerTag],
    });
    // Relations are tags, not references: even a mutual relation cannot put
    // a cycle on either builder.
    scroll.simultaneousWithExternalGesture(pan);
    expect(() => JSON.stringify(pan)).not.toThrow();
    expect(() => JSON.stringify(scroll)).not.toThrow();

    const ref: { current: GestureType | undefined } = { current: undefined };
    expect(pan.withRef(ref)).toBe(pan);
    expect(ref.current).toBe(pan);

    // Each kind's own modifiers chain the same way.
    const tap = Gesture.Tap().numberOfTaps(2).maxDuration(300).maxDelay(200);
    expect(__stubGesture(tap).__config).toEqual({
      numberOfTaps: 2,
      maxDuration: 300,
      maxDelay: 200,
    });
    const fling = Gesture.Fling().direction(Directions.LEFT | Directions.RIGHT);
    expect(__stubGesture(fling).__config).toEqual({ direction: 3 });
    expect(__stubGesture(Gesture.LongPress().minDuration(400)).__config).toEqual({
      minDuration: 400,
    });
    expect(__stubGesture(Gesture.Manual().manualActivation(true)).__config).toEqual({
      manualActivation: true,
    });
    // Anything that is not one of this stub's builders fails at the lookup.
    expect(() => __stubGesture({})).toThrow(/not a gesture built by this stub/);
  });

  it('a composed gesture fires each leaf it was built from', () => {
    const seen: string[] = [];
    const pan = Gesture.Pan().onStart(() => {
      seen.push('pan');
    });
    const tap = Gesture.Tap().onStart(() => {
      seen.push('tap');
    });
    const press = Gesture.LongPress();
    const both = Gesture.Simultaneous(pan, Gesture.Exclusive(tap, press));

    expect(__stubGesture(both).__gestures).toHaveLength(2);
    expect(both.toGestureArray()).toEqual([pan, tap, press]);
    expect(__fireGesture(both, 'start')).toBe(true);
    expect(seen).toEqual(['pan', 'tap']);
    // No leaf registered onBegin → nothing ran, and it says so. (Exclusive,
    // not the first-wins composer: that one is deliberately absent from the
    // stub because its name is a token the §59 safety scan bans — see the
    // stub header.)
    expect(__fireGesture(Gesture.Exclusive(pan, tap), 'begin')).toBe(false);
  });

  it('a gesture built inside a screen is reachable through the mounted registry', () => {
    let dismissed = 0;
    const onDismiss = (): void => {
      dismissed += 1;
    };
    const tree = render(<Sheet onDismiss={onDismiss} />);
    expect(__mountedGestures()).toHaveLength(1);

    const drag = __mountedGesture('sheet-drag');
    expect(drag.__config['activeOffsetY']).toBe(12);
    act(() => {
      __fireGesture(drag, 'end', { translationY: 20 });
    });
    expect(dismissed).toBe(0);
    act(() => {
      __fireGesture(drag, 'end', { translationY: 120, velocityY: 600 });
    });
    expect(dismissed).toBe(1);

    expect(() => __mountedGesture('nope')).toThrow(/no mounted gesture/);

    act(() => {
      tree.unmount();
    });
    expect(__mountedGestures()).toEqual([]);
  });
});

describe('GestureHandlerRootView / legacy handlers / HOC', () => {
  it('GestureHandlerRootView is a flex:1 rn-view that keeps the caller style', () => {
    const tree = render(
      <GestureHandlerRootView style={{ backgroundColor: 'black' }} testID="root">
        <View />
      </GestureHandlerRootView>,
    );
    const root = host(tree, 'rn-view');
    expect(root.props['testID']).toBe('root');
    expect(root.props['style']).toEqual([{ flex: 1 }, { backgroundColor: 'black' }]);

    const bare = render(<GestureHandlerRootView />);
    expect(host(bare, 'rn-view').props['style']).toEqual({ flex: 1 });
  });

  it('legacy handlers render children only, so an Animated.event object never reaches a host', () => {
    // Widened on purpose: the real props would refuse a cyclic instance as an
    // event sink, which is exactly why the guard must not rely on the type
    // system (an `Animated.event` object is a legal value there).
    const evil = {
      onGestureEvent: new Cyclic(),
      waitFor: { current: new Cyclic() },
    } as unknown as PanGestureHandlerProps;
    const tree = render(
      <PanGestureHandler {...evil}>
        <View>
          <Text>Legacy</Text>
        </View>
      </PanGestureHandler>,
    );
    expect(() => textOf(tree)).not.toThrow();
    expect(textOf(tree)).toContain('Legacy');
    expect(textOf(tree)).not.toContain('onGestureEvent');
  });

  it('State and Directions carry the library values; the HOC is identity', () => {
    expect(State).toEqual({
      UNDETERMINED: 0,
      FAILED: 1,
      BEGAN: 2,
      CANCELLED: 3,
      ACTIVE: 4,
      END: 5,
    });
    expect(Directions).toEqual({ RIGHT: 1, LEFT: 2, UP: 4, DOWN: 8 });
    const Screen = (): ReactElement => (
      <View>
        <Text>Screen</Text>
      </View>
    );
    expect(gestureHandlerRootHOC(Screen)).toBe(Screen);
  });
});

describe('RectButton', () => {
  it('is a gh-rectbutton host: onPress callable, relation refs dropped, bare text rejected', () => {
    let pressed = 0;
    const tree = render(
      <RectButton
        accessibilityLabel="Save"
        onPress={() => {
          pressed += 1;
        }}
        waitFor={{ current: new Cyclic() }}
        style={{ padding: 12 }}
      >
        <Text>Save</Text>
      </RectButton>,
    );
    expect(() => textOf(tree)).not.toThrow();
    const button = host(tree, 'gh-rectbutton');
    expect(button.props['waitFor']).toBeUndefined();
    expect(button.props['style']).toEqual({ padding: 12 });
    act(() => {
      (button.props as { onPress: () => void }).onPress();
    });
    expect(pressed).toBe(1);

    expect(() => render(<RectButton>bare</RectButton>)).toThrow(/RN text invariant/);
  });
});

describe('FlatList', () => {
  interface Row {
    id: string;
    label: string;
  }
  const rows: Row[] = [
    { id: 'a', label: 'Alpha' },
    { id: 'b', label: 'Beta' },
  ];
  const Header = (): ReactElement => <Text>Header</Text>;

  it('renders header, keyed rows with separators, footer — as children, never as props', () => {
    const tree = render(
      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <Text>{item.label}</Text>}
        ListHeaderComponent={Header}
        ListFooterComponent={<Text>Footer</Text>}
        ItemSeparatorComponent={() => <View testID="sep" />}
        extraData={new Cyclic()}
        contentContainerStyle={{ padding: 8 }}
      />,
    );
    expect(() => textOf(tree)).not.toThrow();
    const text = textOf(tree);
    for (const s of ['Header', 'Alpha', 'Beta', 'Footer']) expect(text).toContain(s);
    expect(text.indexOf('Header')).toBeLessThan(text.indexOf('Alpha'));
    expect(text.indexOf('Alpha')).toBeLessThan(text.indexOf('Beta'));
    expect(text.indexOf('Beta')).toBeLessThan(text.indexOf('Footer'));
    // Pinned to the HOST: rn-stub's View is a composite whose props also
    // carry the testID, so an untyped predicate would count each once more.
    expect(hosts(tree, 'rn-view').filter((n) => n.props['testID'] === 'sep')).toHaveLength(1);

    const list = host(tree, 'rn-flatlist');
    expect(list.props['contentContainerStyle']).toEqual({ padding: 8 });
    for (const dropped of [
      'data',
      'extraData',
      'renderItem',
      'keyExtractor',
      'ListHeaderComponent',
    ]) {
      expect(list.props[dropped]).toBeUndefined();
    }
  });

  it('renders the empty slot for no data, and answers the scroll methods through a ref', () => {
    // Typed as the REAL list ref (the intersection RNGH declares), the way a
    // screen holds one; at runtime it is the stub's no-op handle.
    const ref = createRef<FlatList<Row>>();
    const tree = render(
      <FlatList<Row>
        ref={ref}
        data={[]}
        renderItem={() => null}
        ListEmptyComponent={<Text>Nothing yet</Text>}
      />,
    );
    expect(textOf(tree)).toContain('Nothing yet');
    expect(ref.current).not.toBeNull();
    expect(() => ref.current?.scrollToOffset({ offset: 0 })).not.toThrow();
  });

  it('falls back to item.id as the key when no keyExtractor is given', () => {
    const tree = render(
      <FlatList data={rows} renderItem={({ item }) => <Text>{item.label}</Text>} />,
    );
    // Fragments carry the key; the only observable is a warning-free render
    // with both rows present in order.
    const text = textOf(tree);
    expect(text.indexOf('Alpha')).toBeLessThan(text.indexOf('Beta'));
  });
});
